// Storage fallback, in tiers (similar to Arc's auto-archive):
//   Tier 1  Everything lives in IndexedDB (unlimitedStorage).
//   Tier 2  Past the soft budget, full-size media of the least recently opened
//           saves is dropped. Thumbnails, text and the AI index stay, so search
//           still works and media can be refetched from the original URL.
//   Tier 3  Past the hard budget, the oldest saves are written to a JSON
//           archive file in Downloads/magpie-vault/ and replaced by slim stubs
//           that keep their summary and embedding. Import the file to restore.
// A write that hits QuotaExceededError triggers the guard and retries.
import { items, blobs } from './db.js';
import { getSettings, blobToBase64 } from './util.js';

const MB = 1048576;

export async function estimate() {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0 };
  } catch { return { used: 0, quota: 0 }; }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export async function downloadJSON(obj, filename, conflictAction = 'uniquify') {
  const json = JSON.stringify(obj);
  const b64 = await blobToBase64(new Blob([json], { type: 'application/json' }));
  return chrome.downloads.download({ url: 'data:application/json;base64,' + b64, filename, conflictAction, saveAs: false });
}

async function protectedIds() {
  const { basket = [] } = await chrome.storage.local.get('basket');
  return new Set(basket.map(b => b.id));
}

export async function freeMedia(list, targetBytes) {
  let freed = 0, count = 0;
  for (const it of list) {
    if (targetBytes != null && freed >= targetBytes) break;
    const keys = (it.media || []).map(m => m.fullKey).filter(Boolean);
    if (!keys.length) continue;
    for (const k of keys) {
      const b = await blobs.get(k);
      freed += b?.size || 0;
      await blobs.del(k);
    }
    await items.patch(it.id, x => ({ ...x, media: (x.media || []).map(m => ({ ...m, fullKey: null, evicted: !!m.fullKey || m.evicted })) }));
    count++;
  }
  return { freed, count };
}

export async function archiveItems(ids) {
  const full = (await items.getMany(ids)).filter(Boolean).filter(i => !i.archived);
  if (!full.length) return 0;
  const filename = `magpie-vault/archive-${stamp()}.json`;
  await downloadJSON({ magpie: 1, kind: 'archive', exportedAt: new Date().toISOString(), items: full }, filename);
  for (const it of full) {
    for (const m of it.media || []) if (m.fullKey) await blobs.del(m.fullKey);
    await items.put({
      id: it.id, platform: it.platform, url: it.url, author: it.author,
      text: (it.text || '').slice(0, 280), createdAt: it.createdAt, savedAt: it.savedAt, updatedAt: Date.now(),
      media: (it.media || []).map(m => ({ type: m.type, url: m.url, poster: m.poster, thumbKey: m.thumbKey, w: m.w, h: m.h })),
      ai: it.ai ? { title: it.ai.title, summary: it.ai.summary, tags: it.ai.tags, category: it.ai.category, places: it.ai.places } : null,
      embedding: it.embedding, status: it.status === 'indexed' ? 'indexed' : 'error',
      archived: { file: filename, at: Date.now() }, pinned: false,
    });
  }
  return full.length;
}

// mode: false (auto), 'media' (force tier 2), 'archive' (force tier 3)
export async function runGuard({ mode = false } = {}) {
  const s = await getSettings();
  let { used, quota } = await estimate();
  const soft = Math.min(s.softMB * MB, (quota || Infinity) * 0.7);
  const hard = Math.min(s.hardMB * MB, (quota || Infinity) * 0.85);
  const report = { before: used, evicted: 0, archived: 0 };
  if (!mode && used < soft) return report;

  const keep = await protectedIds();
  const list = (await items.all())
    .filter(i => !i.pinned && !keep.has(i.id) && !i.archived)
    .sort((a, b) => (a.lastOpened || a.savedAt || 0) - (b.lastOpened || b.savedAt || 0));

  if (mode === 'media' || used >= soft) {
    const target = mode === 'media' ? null : used - soft * 0.85;
    const r = await freeMedia(list, target);
    report.evicted = r.count;
    ({ used } = await estimate());
  }
  if (mode === 'archive' || used >= hard) {
    const n = mode === 'archive' ? Math.max(50, Math.floor(list.length * 0.25)) : 250;
    report.archived = await archiveItems(list.slice(0, n).map(i => i.id));
  }
  report.after = (await estimate()).used;
  return report;
}

// Writes the whole searchable index (no media bytes) to a JSON file on disk.
export async function snapshotIndex() {
  const all = await items.all();
  return downloadJSON({ magpie: 1, kind: 'index', exportedAt: new Date().toISOString(), count: all.length, items: all },
    'magpie-vault/index-latest.json', 'overwrite');
}
