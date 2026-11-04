import { items, blobs, kv } from './lib/db.js';
import * as G from './lib/gemini.js';
import { getSettings, blobToBase64, docText, hashStr } from './lib/util.js';
import { runGuard, snapshotIndex } from './lib/storage-guard.js';

const broadcast = msg => chrome.runtime.sendMessage(msg).catch(() => {});

// ---------- lifecycle ----------
function setup() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mgp-save', title: 'Stash in Magpie', contexts: ['page', 'link', 'image', 'video', 'selection'] });
  });
  chrome.alarms.create('pump', { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(() => { setup(); pump(); });
chrome.runtime.onStartup.addListener(() => { setup(); pump(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'pump') pump(); });
chrome.storage.onChanged.addListener(c => { if (c.settings) { paused = false; lastErr = null; pump(); } });

// ---------- messages ----------
const H = {
  async ingest({ item }) { return upsert(item); },
  async has({ ids = [] }) { const got = await items.getMany(ids); return { saved: got.filter(Boolean).map(i => i.id) }; },
  async 'panel:open'(_, sender) {
    try { await chrome.sidePanel.open({ tabId: sender.tab.id }); return { ok: true }; }
    catch { return { ok: false }; }
  },
  async 'basket:add'({ entry }) {
    const { basket = [] } = await chrome.storage.local.get('basket');
    if (!basket.some(b => b.id === entry.id)) basket.unshift({ kind: 'item', ...entry, addedAt: Date.now() });
    await chrome.storage.local.set({ basket });
    return { ok: true };
  },
  async 'settings:has-key'() { const s = await getSettings(); return { hasKey: !!s.geminiKey }; },
  async 'queue:kick'() { paused = false; lastErr = null; pump(); return { ok: true }; },
  async 'queue:status'() { return queueStatus(); },
  async 'item:reindex'({ id }) {
    await items.patch(id, x => ({ ...x, status: x.media?.some(m => !m.thumbKey) ? 'new' : 'captured', attempts: 0, nextTry: 0, error: null, noMedia: false }));
    paused = false; pump();
    return { ok: true };
  },
  async 'guard:run'({ mode }) { const r = await runGuard({ mode }); broadcast({ type: 'items:changed', ids: [] }); return r; },
  async 'ig:user'({ user }) { await chrome.storage.local.set({ igUser: user }); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = H[msg?.type];
  if (!h) return false;
  h(msg, sender).then(reply, e => reply({ error: String(e?.message || e) }));
  return true;
});

// ---------- ingest ----------
const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null && v !== '' && !(typeof v === 'number' && isNaN(v))));
const mediaScore = (m = []) => m.length + m.filter(x => x.type === 'video' && x.url).length * 2 + m.filter(x => x.type === 'image' && x.url).length;

async function safePut(item) {
  try { await items.put(item); }
  catch (e) {
    if (e?.name !== 'QuotaExceededError') throw e;
    await runGuard({ mode: 'media' });
    await items.put(item);
  }
}

async function upsert(it) {
  if (!it?.id || !it.platform) return { error: 'Missing id or platform' };
  const ex = await items.get(it.id);
  const now = Date.now();
  if (ex) {
    const better = !ex.archived && mediaScore(it.media) > mediaScore(ex.media);
    const next = {
      ...ex,
      author: { ...ex.author, ...clean(it.author) },
      text: (it.text || '').length > (ex.text || '').length ? it.text : ex.text,
      metrics: { ...ex.metrics, ...clean(it.metrics) },
      links: [...new Set([...(ex.links || []), ...(it.links || [])])],
      location: it.location || ex.location,
      createdAt: ex.createdAt || it.createdAt,
      quoted: ex.quoted || it.quoted,
      partial: !!(ex.partial && it.partial),
      updatedAt: now,
    };
    if (better) { next.media = it.media; if (ex.status !== 'indexing') next.status = 'new'; }
    await safePut(next);
    broadcast({ type: 'items:changed', ids: [it.id] });
    if (better) pump();
    return { isNew: false, id: it.id };
  }
  const item = { ...it, savedAt: now, updatedAt: now, status: 'new', ai: null, pinned: false, attempts: 0 };
  await safePut(item);
  broadcast({ type: 'items:changed', ids: [it.id], fresh: true });
  pump();
  return { isNew: true, id: it.id };
}

// ---------- queue ----------
let pumping = false, paused = false, lastErr = null;

async function queueStatus() {
  const [n, c, ix] = await Promise.all([items.byIndex('status', 'new'), items.byIndex('status', 'captured'), items.byIndex('status', 'indexing')]);
  const s = await getSettings();
  return { capturing: n.length, waiting: s.geminiKey ? 0 : c.length, indexing: s.geminiKey ? c.length + ix.length : 0, paused, error: lastErr };
}

async function pool(list, n, fn) {
  const q = [...list];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) { const x = q.shift(); try { await fn(x); } catch (e) { console.warn('[magpie]', e); } }
  }));
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (const it of await items.byIndex('status', 'indexing')) {
      if (Date.now() - (it.indexStarted || 0) > 5 * 60e3) await items.patch(it.id, { status: 'captured' });
    }
    for (let round = 0; round < 400; round++) {
      const s = await getSettings();
      const toCap = (await items.byIndex('status', 'new')).slice(0, 6);
      const canIndex = s.geminiKey && s.autoIndex && !paused;
      const toIdx = canIndex
        ? (await items.byIndex('status', 'captured')).filter(i => !i.nextTry || i.nextTry <= Date.now()).sort((a, b) => b.savedAt - a.savedAt).slice(0, 2)
        : [];
      if (!toCap.length && !toIdx.length) break;
      broadcast({ type: 'queue:status', ...(await queueStatus()) });
      await Promise.all([pool(toCap, 3, capture), pool(toIdx, 2, it => indexItem(it, s))]);
    }
  } finally {
    pumping = false;
    broadcast({ type: 'queue:status', ...(await queueStatus()) });
    runGuard().catch(() => {});
    maybeSnapshot().catch(() => {});
  }
}

async function maybeSnapshot() {
  const s = await getSettings();
  const n = (await kv.get('sinceSnapshot')) || 0;
  if (s.autoSnapshot && n >= 50) { await snapshotIndex(); await kv.put('sinceSnapshot', 0); }
}

// ---------- capture (no AI) ----------
async function fetchBlob(url, maxBytes = Infinity) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  const r = await fetch(url, { credentials: 'omit' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = +r.headers.get('content-length') || 0;
  if (len && len > maxBytes) { r.body?.cancel().catch(() => {}); return null; }
  const b = await r.blob();
  return b.size > maxBytes ? null : b;
}

async function makeThumb(blob, max = 640) {
  try {
    const bmp = await createImageBitmap(blob);
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * sc)), Math.max(1, Math.round(bmp.height * sc)));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await c.convertToBlob({ type: 'image/webp', quality: 0.82 });
    return { blob: out, w: bmp.width, h: bmp.height };
  } catch { return { blob }; }
}

async function capture(item) {
  const s = await getSettings();
  const media = [...(item.media || [])];
  let author = item.author || {};
  try {
    if (author.avatar && !author.avatarKey) {
      const b = await fetchBlob(author.avatar, 2e6);
      if (b) { const t = await makeThumb(b, 96); await blobs.put(`ava:${item.id}`, t.blob); author = { ...author, avatarKey: `ava:${item.id}` }; }
    }
  } catch {}
  for (let i = 0; i < Math.min(media.length, 12); i++) {
    const m = { ...media[i] };
    try {
      const src = m.type === 'video' ? m.poster : m.url;
      if (src && !m.thumbKey) {
        const b = await fetchBlob(src, 25e6);
        if (b) {
          const t = await makeThumb(b, 720);
          const k = `thumb:${item.id}:${i}`;
          await blobs.put(k, t.blob);
          m.thumbKey = k; m.w = m.w || t.w; m.h = m.h || t.h;
          if (m.type === 'image' && s.storeMedia) {
            await blobs.put(`full:${item.id}:${i}`, b);
            m.fullKey = `full:${item.id}:${i}`; m.bytes = b.size; m.mime = b.type;
          }
        }
      }
      if (m.type === 'video' && m.url && s.storeMedia && !m.fullKey) {
        const vb = await fetchBlob(m.url, s.maxVideoMB * 1e6);
        if (vb) {
          await blobs.put(`vid:${item.id}:${i}`, vb);
          m.fullKey = `vid:${item.id}:${i}`; m.bytes = vb.size; m.mime = vb.type || 'video/mp4';
        }
      }
    } catch (e) {
      if (e?.name === 'QuotaExceededError') await runGuard({ mode: 'media' }).catch(() => {});
      m.err = String(e?.message || e);
    }
    media[i] = m;
  }
  await items.patch(item.id, x => ({ ...x, media, author, status: 'captured', capturedAt: Date.now() }));
  broadcast({ type: 'items:changed', ids: [item.id] });
}

// ---------- index (Gemini) ----------
const T = d => (d ? { type: 'STRING', description: d } : { type: 'STRING' });
const A = (items, d) => ({ type: 'ARRAY', items, description: d });
const INDEX_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: T('Specific 3 to 8 word title'),
    summary: T('2 to 3 sentences: what this is and why someone would save it'),
    category: T('One of: travel, food, recipe, shopping, fashion, fitness, tech, learning, design, finance, career, entertainment, news, humor, home, other'),
    tags: A(T(), '5 to 12 lowercase topical tags'),
    places: A({
      type: 'OBJECT',
      properties: { name: T(), kind: T('hotel, restaurant, cafe, bar, beach, attraction, market, neighborhood, city, shop, venue, other'), city: T(), country: T(), note: T('What the post says about it') },
      required: ['name'],
    }, 'Every specific place named, shown, or tagged'),
    entities: A(T(), 'Brands, products, dishes, people, tools, books'),
    prices: A(T(), 'Prices with currency and what they are for'),
    ocr: T('All readable on-screen text from the images and video frames'),
    transcript: T('Speech in the video(s), with [mm:ss] markers where possible'),
    visual: T('Concise description of what the images and video show'),
    moments: A({ type: 'OBJECT', properties: { t: T('mm:ss'), d: T('What happens') }, required: ['t', 'd'] }, 'Key moments in the video'),
    actionable: A(T(), 'Concrete things to do from this: book X, try Y, buy Z'),
    links: A(T(), 'URLs, websites or handles mentioned'),
    language: T('ISO 639-1 code of the main language'),
  },
  required: ['title', 'summary', 'category', 'tags'],
};

function indexPrompt(it) {
  const meta = {
    platform: it.platform, url: it.url,
    author: it.author ? `${it.author.name || ''} @${it.author.handle || ''}` : undefined,
    postedAt: it.createdAt, location: it.location?.name, hashtags: it.hashtags, audio: it.audio,
    links: it.links, metrics: it.metrics, quoted: it.quoted?.text,
  };
  return `You are indexing a saved social post so its owner can search it and plan from it later.
Analyze every attached image and video carefully. Read all on-screen text, transcribe speech, and capture specifics:
place names, addresses, dishes, prices, products, hotels, dates, opening hours, tips, and the timestamps of key moments.
Be factual and specific. Leave a field empty rather than guess.

Metadata: ${JSON.stringify(meta)}
Post text:
"""${(it.text || '').slice(0, 6000)}"""`;
}

function cleanAI(ai = {}) {
  const arr = v => (Array.isArray(v) ? v.filter(Boolean) : []);
  return {
    title: ai.title || '', summary: ai.summary || '', category: (ai.category || 'other').toLowerCase(),
    tags: arr(ai.tags).map(t => String(t).toLowerCase().replace(/^#/, '')).slice(0, 14),
    places: arr(ai.places), entities: arr(ai.entities), prices: arr(ai.prices),
    ocr: ai.ocr || '', transcript: ai.transcript || '', visual: ai.visual || '',
    moments: arr(ai.moments), actionable: arr(ai.actionable), links: arr(ai.links), language: ai.language || '',
  };
}

async function indexItem(it, s) {
  await items.patch(it.id, { status: 'indexing', indexStarted: Date.now() });
  broadcast({ type: 'items:changed', ids: [it.id] });
  const media = [...(it.media || [])];
  const parts = [{ text: indexPrompt(it) }];

  if (!it.noMedia) {
    let imgs = 0, vids = 0, inline = 0;
    for (let i = 0; i < media.length; i++) {
      const m = { ...media[i] };
      try {
        if (m.type === 'image' && imgs < 8) {
          const b = (m.fullKey && await blobs.get(m.fullKey)) || (m.thumbKey && await blobs.get(m.thumbKey)) || await fetchBlob(m.url, 15e6);
          if (b && inline + b.size < 12e6) {
            parts.push({ text: `[Media ${i + 1}: image]` }, { inlineData: { mimeType: b.type || 'image/jpeg', data: await blobToBase64(b) } });
            inline += b.size; imgs++;
          }
        } else if (m.type === 'video' && vids < 3) {
          if (m.fileUri && m.fileExp > Date.now() + 3600e3) {
            parts.push({ text: `[Media ${i + 1}: video]` }, { fileData: { mimeType: m.fileMime || 'video/mp4', fileUri: m.fileUri } });
            vids++;
          } else {
            const b = (m.fullKey && await blobs.get(m.fullKey)) || await fetchBlob(m.url, 1.9e9);
            if (b) {
              const mime = b.type && b.type.startsWith('video') ? b.type : 'video/mp4';
              if (b.size < 8e6 && inline + b.size < 12e6) {
                parts.push({ text: `[Media ${i + 1}: video]` }, { inlineData: { mimeType: mime, data: await blobToBase64(b) } });
                inline += b.size;
              } else {
                const f = await G.uploadFile(s.geminiKey, b, mime, it.id);
                Object.assign(m, { fileUri: f.uri, fileExp: f.expires, fileMime: f.mimeType });
                parts.push({ text: `[Media ${i + 1}: video]` }, { fileData: { mimeType: f.mimeType, fileUri: f.uri } });
              }
              vids++;
            } else if (m.thumbKey) {
              const p = await blobs.get(m.thumbKey);
              if (p) parts.push({ text: `[Media ${i + 1}: video poster frame only; the video itself was unavailable]` }, { inlineData: { mimeType: p.type || 'image/webp', data: await blobToBase64(p) } });
            }
          }
        }
      } catch (e) { m.err = String(e?.message || e); }
      media[i] = m;
    }
  }

  try {
    const raw = await G.generateJSON(s.geminiKey, s.model, { contents: [{ role: 'user', parts }], schema: INDEX_SCHEMA, thinking: 'low' });
    const ai = cleanAI(raw);
    let embedding = null;
    try { [embedding] = await G.embed(s.geminiKey, s.embedModel, [docText({ ...it, ai })], 'RETRIEVAL_DOCUMENT'); }
    catch (e) { console.warn('[magpie] embed failed', e?.message); }
    await items.patch(it.id, x => ({ ...x, media, ai, embedding, status: 'indexed', indexedAt: Date.now(), error: null, attempts: 0 }));
    await kv.put('sinceSnapshot', ((await kv.get('sinceSnapshot')) || 0) + 1);
  } catch (e) {
    const err = e instanceof G.GeminiError ? e : null;
    const attempts = (it.attempts || 0) + 1;
    const msg = String(e?.message || e).slice(0, 300);
    if (err?.isAuth) {
      paused = true; lastErr = 'Gemini rejected the API key. Update it in Settings.';
      await items.patch(it.id, { status: 'captured', media });
    } else if (err?.status === 404) {
      paused = true; lastErr = `Model "${s.model}" isn't available for this key. Pick another model in Settings.`;
      await items.patch(it.id, { status: 'captured', media });
    } else if (err?.status === 400 && !it.noMedia) {
      await items.patch(it.id, { status: 'captured', noMedia: true, media, error: msg });
    } else if (attempts > 4) {
      await items.patch(it.id, { status: 'error', error: msg, media, attempts });
    } else {
      await items.patch(it.id, { status: 'captured', attempts, nextTry: Date.now() + attempts * attempts * 30e3, media, error: msg });
    }
  }
  broadcast({ type: 'items:changed', ids: [it.id] });
}

// ---------- context menu: stash any page, link or image ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl;
  if (!url) return;
  let text = info.selectionText || '';
  let title = info.linkUrl ? (info.selectionText || url) : (tab?.title || url);
  const media = [];
  if (info.srcUrl && !info.srcUrl.startsWith('blob:')) media.push({ type: info.mediaType === 'video' ? 'video' : 'image', url: info.srcUrl });
  if (!info.linkUrl && !info.srcUrl && tab?.id) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          og: document.querySelector('meta[property="og:image"]')?.content || '',
          desc: document.querySelector('meta[name="description"]')?.content || '',
          body: (document.querySelector('article, main') || document.body).innerText.slice(0, 8000),
        }),
      });
      const v = r?.result || {};
      if (v.og) media.push({ type: 'image', url: v.og });
      if (!text) text = [v.desc, v.body].filter(Boolean).join('\n\n');
    } catch {}
  }
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch {}
  await upsert({ id: 'web:' + hashStr(url + (info.srcUrl || '')), platform: 'web', url, title, author: { name: host, handle: host }, text, media, createdAt: new Date().toISOString(), source: 'context-menu' });
});
