import { items, blobs, threads, plans as plansDB } from '../lib/db.js';
import { getSettings, setSettings, uid, base64ToBlob, blobToBase64 } from '../lib/util.js';
import { bm25 } from '../lib/search.js';
import * as G from '../lib/gemini.js';
import { verifyExa } from '../lib/exa.js';
import { estimate, downloadJSON } from '../lib/storage-guard.js';
import { ask, BUILTIN_SKILLS, readTab } from './chat.js';
import { renderMarkdown, taskStats } from './md.js';
import {
  $, $$, esc, ICON, relTime, itemTitle, platformName, platformIcon, host,
  getBasket, setBasket, addToBasket, removeFromBasket, toast, observeImages,
  mediaSlidesHTML, hydrateMedia, peekBodyHTML, wireSegs,
} from './shared.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const SPACES = [
  { id: 'all', name: 'Everything', icon: 'spark' },
  { id: 'x', name: 'X bookmarks', icon: 'x' },
  { id: 'instagram', name: 'Instagram saves', icon: 'ig' },
  { id: 'basket', name: 'Basket', icon: 'basket' },
  { id: 'plans', name: 'Plans', icon: 'plan' },
];
const SPRING = 'linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001)';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMac = /Mac/.test(navigator.userAgent);
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

const S = {
  space: 'all', items: [], byId: new Map(), plans: [], basket: [], settings: null,
  selecting: false, selected: new Set(), tag: null, limit: 60, known: new Set(), firstLoad: true,
  thread: null, mentions: [], skill: null, busy: false, abort: null,
  pop: null, popSel: 0, palSel: 0, palRows: [], peek: null, queue: {}, crawl: null,
};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
async function loadItems() {
  const all = await items.all();
  all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const fresh = S.firstLoad ? [] : all.filter(i => !S.known.has(i.id)).map(i => i.id);
  S.items = all;
  S.byId = new Map(all.map(i => [i.id, i]));
  all.forEach(i => S.known.add(i.id));
  S.firstLoad = false;
  return fresh;
}
async function loadPlans() { S.plans = (await plansDB.all()).sort((a, b) => b.createdAt - a.createdAt); }
const skills = () => [...BUILTIN_SKILLS, ...(S.settings?.skills || [])];
const tagsOf = it => it.ai?.tags?.length ? it.ai.tags : (it.hashtags || []).map(t => t.toLowerCase());
const inBasket = id => S.basket.some(b => b.id === id);

function spaceItems() {
  if (S.space === 'x' || S.space === 'instagram') return S.items.filter(i => i.platform === S.space);
  return S.items;
}
function visibleItems() {
  const list = spaceItems();
  return S.tag ? list.filter(i => tagsOf(i).includes(S.tag)) : list;
}

let reloadTimer = 0;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    const fresh = await loadItems();
    const scroller = $('#stage');
    const top = scroller.scrollTop;
    renderSpace({ fresh });
    scroller.scrollTop = top;
    refreshPeekBody();
  }, 280);
}

// ---------------------------------------------------------------------------
// Spaces (Arc-style: each has its own colour, swipe or Alt+1…5 to switch)
// ---------------------------------------------------------------------------
function renderSpacesNav() {
  $('#spaces').innerHTML = '<span class="sp-ind" aria-hidden="true"></span>' + SPACES.map((s, i) => `
    <button class="sp" data-space="${s.id}" title="${s.name}  (${isMac ? '⌥' : 'Alt+'}${i + 1})" aria-label="${s.name}">
      ${ICON[s.icon]}${s.id === 'basket' ? '<span class="badge" id="basketBadge" hidden></span>' : ''}
    </button>`).join('');
  updateNav();
}
function updateNav() {
  const i = SPACES.findIndex(s => s.id === S.space);
  $('#spaces').style.setProperty('--i', i);
  $$('#spaces .sp').forEach(b => b.setAttribute('aria-current', b.dataset.space === S.space ? 'true' : 'false'));
  const badge = $('#basketBadge');
  if (badge) {
    const n = S.basket.length;
    if (String(n) !== badge.textContent && n) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
    badge.textContent = n; badge.hidden = !n;
  }
}

function setSpace(id, { instant = false } = {}) {
  if (!SPACES.some(s => s.id === id)) return;
  if (id === S.space && !instant) { $('#stage').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const order = SPACES.map(s => s.id);
  document.documentElement.dataset.dir = order.indexOf(id) >= order.indexOf(S.space) ? 'next' : 'prev';
  const apply = () => {
    S.space = id; S.tag = null; S.limit = 60;
    document.documentElement.dataset.space = id;
    updateNav();
    renderSpace();
    $('#stage').scrollTop = 0;
    chrome.storage.local.set({ ui: { space: id } });
  };
  if (!$('#askSheet').hidden) closeAsk();
  if (document.startViewTransition && !reduced && !instant) document.startViewTransition(apply);
  else apply();
}
const stepSpace = d => {
  const i = SPACES.findIndex(s => s.id === S.space);
  const n = SPACES[(i + d + SPACES.length) % SPACES.length];
  setSpace(n.id);
};

// ---------------------------------------------------------------------------
// Space rendering
// ---------------------------------------------------------------------------
function renderSpace({ fresh = [] } = {}) {
  const sp = SPACES.find(s => s.id === S.space);
  $('#spaceTitle').textContent = sp.name;
  renderSub();
  renderHeadActions();
  if (S.space === 'plans') return renderPlans();
  if (S.space === 'basket') return renderBasketSpace();

  const list = spaceItems();
  renderTags(list);
  renderPinned(list);
  const shown = visibleItems();
  const feed = $('#feed');
  feed.className = 'feed ' + (S.space === 'x' ? 'list' : 'masonry');
  if (!shown.length) { feed.innerHTML = emptyHTML(S.space); $('#sentinel').dataset.more = ''; return; }
  patchFeed(feed, shown.slice(0, S.limit), fresh);
  $('#sentinel').dataset.more = shown.length > S.limit ? '1' : '';
  observeImages(feed);
}

// Reuse card nodes whose content hasn't changed, so loaded thumbnails don't
// flash while a crawl streams new saves in.
const sigOf = it => `${it.updatedAt || 0}|${it.status}|${it.indexedAt || 0}|${it.capturedAt || 0}|${S.selected.has(it.id) ? 1 : 0}|${it.pinned ? 1 : 0}|${S.settings?.geminiKey ? 1 : 0}`;
function patchFeed(feed, list, fresh) {
  const existing = new Map([...feed.children].filter(n => n.dataset?.id).map(n => [n.dataset.id, n]));
  const frag = document.createDocumentFragment();
  const tpl = document.createElement('template');
  for (const it of list) {
    const sig = sigOf(it);
    let node = existing.get(it.id);
    if (!node || node.dataset.sig !== sig) {
      tpl.innerHTML = cardHTML(it, fresh.includes(it.id)).trim();
      node = tpl.content.firstElementChild;
      node.dataset.sig = sig;
    }
    frag.appendChild(node);
  }
  feed.replaceChildren(frag);
}

function renderSub() {
  const sub = $('#spaceSub');
  const q = S.queue || {};
  if (S.space === 'plans') { sub.textContent = S.plans.length ? `${S.plans.length} saved plan${S.plans.length === 1 ? '' : 's'}` : ''; return; }
  if (S.space === 'basket') { sub.textContent = S.basket.length ? `${S.basket.length} item${S.basket.length === 1 ? '' : 's'}. Mention @Basket in a question to use them all.` : ''; return; }
  const n = spaceItems().length;
  let html = `<span>${n} save${n === 1 ? '' : 's'}</span>`;
  if (q.capturing) html += `<span class="q"><i class="orb"></i>Collecting ${q.capturing}</span>`;
  if (q.indexing) html += `<span class="q"><i class="orb"></i>Indexing ${q.indexing}</span>`;
  if (q.waiting) html += `<button class="q warn" data-act="settings">${q.waiting} waiting for a Gemini key</button>`;
  if (q.error) html += `<button class="q err" data-act="settings">${esc(q.error)}</button>`;
  sub.innerHTML = html;
}

function renderHeadActions() {
  const a = $('#spaceActions');
  if (S.space === 'plans') { a.innerHTML = ''; return; }
  if (S.space === 'basket') {
    a.innerHTML = (S.basket.length ? `<button class="chip-btn" data-act="ask-basket">${ICON.spark}<span>Ask</span></button>` : '') +
      `<button class="chip-btn" data-act="add-tab">${ICON.tab}<span>Add tab</span></button>` +
      (S.basket.length ? `<button class="chip-btn" data-act="clear-basket">${ICON.trash}<span>Clear</span></button>` : '');
    return;
  }
  a.innerHTML = `<button class="chip-btn ${S.selecting ? 'on' : ''}" data-act="select">${ICON.select}<span>${S.selecting ? 'Selecting' : 'Select'}</span></button>` +
    `<button class="chip-btn" data-act="crawl" title="${S.space === 'all' ? 'Crawl the bookmarks page in this tab' : `Open ${platformName(S.space)} and crawl`}">${ICON.crawl}<span>Crawl</span></button>`;
}

function renderTags(list) {
  const counts = new Map();
  for (const it of list) for (const t of tagsOf(it)) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 14);
  $('#tagRail').innerHTML = top.length ? top.map(([t, n]) => `<button class="tag ${S.tag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}<small>${n}</small></button>`).join('') : '';
}

function renderPinned(list) {
  const pins = list.filter(i => i.pinned).slice(0, 12);
  const el = $('#pinned');
  el.innerHTML = pins.length ? pins.map(it => `<button class="pin-tile" data-id="${esc(it.id)}" title="${esc(itemTitle(it))}">${thumbImg(it)}<span>${esc(clip(itemTitle(it), 18))}</span></button>`).join('') : '';
  observeImages(el);
}

function thumbImg(it) {
  const m = (it?.media || [])[0];
  if (!m) return `<span class="ph">${platformIcon(it?.platform)}</span>`;
  return `<img alt="" data-key="${esc(m.thumbKey || '')}" data-src="${esc(m.type === 'video' ? (m.poster || '') : (m.url || ''))}">`;
}

function statusLabel(it) {
  if (it.archived) return 'Archived';
  if (it.status === 'indexed') return '';
  if (it.status === 'indexing') return 'Indexing';
  if (it.status === 'error') return 'Index failed';
  if (it.status === 'new') return 'Collecting';
  return S.settings?.geminiKey ? 'Queued' : 'Needs key';
}

function mediaThumb(m) {
  const src = m.type === 'video' ? (m.poster || '') : (m.url || '');
  return `<div class="mt">${m.thumbKey || src ? `<img alt="" data-key="${esc(m.thumbKey || '')}" data-src="${esc(src)}">` : ''}${m.type === 'video' ? `<span class="play">${ICON.play}</span>` : ''}</div>`;
}

function cardFoot(it) {
  const st = statusLabel(it);
  const tags = tagsOf(it).slice(0, 3);
  if (!st && !tags.length) return '';
  return `<footer class="foot">${st ? `<span class="st st-${it.status}">${st}</span>` : ''}${tags.map(t => `<span class="mini-tag">${esc(t)}</span>`).join('')}</footer>`;
}

function cardHTML(it, isNew) {
  const cls = `card ${it.platform === 'x' ? 'tw' : 'tile'}${isNew ? ' is-new' : ''}${S.selected.has(it.id) ? ' is-sel' : ''}${it.status === 'indexing' ? ' is-indexing' : ''}`;
  const check = `<span class="check" data-act="check" aria-hidden="true">${ICON.check}</span>`;
  const open = `<article class="${cls}" data-id="${esc(it.id)}" draggable="true" tabindex="0" aria-label="${esc(itemTitle(it))}">${check}`;
  if (it.platform === 'x') {
    const m = (it.media || []).slice(0, 4);
    return `${open}
      <header class="tw-head">
        <img class="ava" alt="" data-key="${esc(it.author?.avatarKey || '')}" data-src="${esc(it.author?.avatar || '')}">
        <span class="who"><b>${esc(it.author?.name || '')}</b><span>@${esc(it.author?.handle || '')}</span></span>
        <time>${relTime(it.createdAt || it.savedAt)}</time>
      </header>
      ${it.text ? `<p class="tw-text">${esc(it.text)}</p>` : ''}
      ${m.length ? `<div class="mosaic n${m.length}">${m.map(mediaThumb).join('')}</div>` : ''}
      ${cardFoot(it)}
    </article>`;
  }
  const m0 = (it.media || [])[0];
  const ratio = m0?.w && m0?.h ? Math.max(0.62, Math.min(1.6, m0.h / m0.w)) : 1.25;
  const count = (it.media || []).length;
  const badges = `${m0?.type === 'video' ? `<span class="play">${ICON.play}</span>` : ''}${count > 1 ? `<span class="count">1/${count}</span>` : ''}`;
  return `${open}
    ${m0 ? `<div class="tile-media" style="aspect-ratio: 1 / ${ratio.toFixed(3)}">${mediaThumb({ ...m0, type: 'image', url: m0.type === 'video' ? m0.poster : m0.url })}${badges}</div>`
         : `<div class="tile-text">${esc(clip(it.text || it.title || '', 220))}</div>`}
    <div class="tile-meta"><b>${esc(clip(itemTitle(it), 70))}</b><span class="by">${platformIcon(it.platform)}${esc(it.author?.handle ? '@' + it.author.handle : host(it.url))}</span></div>
    ${cardFoot(it)}
  </article>`;
}

function emptyHTML(space) {
  const copy = {
    all: ['Nothing saved yet', 'Open your X bookmarks or Instagram saved posts and press Crawl, or hover any post and tap the Magpie button.'],
    x: ['No X bookmarks yet', 'Open x.com/i/bookmarks and press Crawl. Magpie scrolls and collects each post, then Gemini indexes its media.'],
    instagram: ['No Instagram saves yet', 'Open your profile, then Saved, then All posts, and press Crawl.'],
    basket: ['Your basket is empty', 'Select saves or drag them onto the basket to build context for a question. You can add open tabs too.'],
    plans: ['No plans yet', 'Ask something like "plan 5 days in Bangkok and Phuket from my saves" and press Save as plan on the answer.'],
  }[space];
  const cta = space === 'x' ? `<button class="btn primary" data-act="crawl">${ICON.crawl}<span>Open X bookmarks</span></button>`
    : space === 'instagram' ? `<button class="btn primary" data-act="crawl">${ICON.crawl}<span>Open Instagram saved</span></button>`
    : space === 'all' ? `<div class="empty-ctas"><button class="btn" data-act="open-x">${ICON.x}<span>X bookmarks</span></button><button class="btn" data-act="open-ig">${ICON.ig}<span>Instagram saved</span></button></div>` : '';
  if (S.tag) return `<div class="empty"><h2>Nothing tagged ${esc(S.tag)} here</h2><button class="btn" data-act="clear-tag">Show everything</button></div>`;
  return `<div class="empty"><div class="empty-mark">${ICON[SPACES.find(s => s.id === space).icon]}</div><h2>${copy[0]}</h2><p>${copy[1]}</p>${cta}</div>`;
}

function renderBasketSpace() {
  $('#tagRail').innerHTML = ''; $('#pinned').innerHTML = '';
  const feed = $('#feed');
  feed.className = 'feed list';
  $('#sentinel').dataset.more = '';
  const rows = S.basket.map(b => {
    if (b.kind === 'tab') {
      return `<div class="brow" data-bid="${esc(b.id)}" data-url="${esc(b.url)}"><div class="brow-thumb">${ICON.tab}</div><div class="brow-main"><b>${esc(b.title || b.url)}</b><span>Tab from ${esc(host(b.url))}</span></div><button class="icon sm" data-act="unbasket" data-bid="${esc(b.id)}" aria-label="Remove">${ICON.close}</button></div>`;
    }
    const it = S.byId.get(b.id);
    if (!it) return '';
    return `<div class="brow" data-bid="${esc(b.id)}" data-id="${esc(it.id)}" draggable="false"><div class="brow-thumb">${thumbImg(it)}</div><div class="brow-main"><b>${esc(itemTitle(it))}</b><span>${platformIcon(it.platform)}${esc(it.author?.handle ? '@' + it.author.handle : host(it.url))}</span></div><button class="icon sm" data-act="unbasket" data-bid="${esc(b.id)}" aria-label="Remove">${ICON.close}</button></div>`;
  }).join('');
  feed.innerHTML = rows || emptyHTML('basket');
  observeImages(feed);
}

function renderPlans() {
  $('#tagRail').innerHTML = ''; $('#pinned').innerHTML = '';
  const feed = $('#feed');
  feed.className = 'feed list';
  $('#sentinel').dataset.more = '';
  if (!S.plans.length) { feed.innerHTML = emptyHTML('plans'); return; }
  feed.innerHTML = S.plans.map(p => {
    const st = taskStats(p.md, p.checks);
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    const thumbs = (p.itemIds || []).map(id => S.byId.get(id)).filter(Boolean).slice(0, 6);
    return `<article class="plan-card" data-plan="${esc(p.id)}" tabindex="0">
      <div class="plan-top"><b>${esc(p.title)}</b><time>${relTime(p.createdAt)}</time></div>
      ${p.question ? `<p>${esc(clip(p.question, 140))}</p>` : ''}
      ${thumbs.length ? `<div class="plan-thumbs">${thumbs.map(t => `<span>${thumbImg(t)}</span>`).join('')}</div>` : ''}
      ${st.total ? `<div class="prog" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><small class="prog-label">${st.done} of ${st.total} ready</small>` : ''}
    </article>`;
  }).join('');
  observeImages(feed);
}

// ---------------------------------------------------------------------------
// Peek (Arc Peek: preview grows out of the card it came from)
// ---------------------------------------------------------------------------
function currentListIds() {
  if (S.space === 'basket') return S.basket.filter(b => b.kind !== 'tab').map(b => b.id);
  return visibleItems().map(i => i.id);
}

function openLayer(html, fromEl) {
  const el = $('#peek');
  el.innerHTML = html;
  el.hidden = false;
  const card = el.querySelector('.peek-card');
  if (!reduced) {
    el.querySelector('.peek-scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    if (fromEl?.isConnected) {
      const r = fromEl.getBoundingClientRect(), P = card.getBoundingClientRect();
      card.animate([
        { clipPath: `inset(${r.top - P.top}px ${P.right - r.right}px ${P.bottom - r.bottom}px ${r.left - P.left}px round 14px)`, opacity: 0.6 },
        { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 },
      ], { duration: 540, easing: SPRING });
    } else {
      card.animate([{ transform: 'translateY(28px) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SPRING });
    }
  }
  return el;
}

async function closeLayer() {
  const el = $('#peek');
  if (el.hidden) return;
  el.querySelectorAll('video').forEach(v => v.pause());
  const card = el.querySelector('.peek-card');
  if (!reduced && card) {
    const target = S.peek?.id ? $(`#spaceView [data-id="${CSS.escape(S.peek.id)}"]`) : S.peek?.planEl;
    const P = card.getBoundingClientRect();
    let anim;
    if (target?.isConnected) {
      const r = target.getBoundingClientRect();
      anim = card.animate([
        { clipPath: 'inset(0px 0px 0px 0px round 22px)', opacity: 1 },
        { clipPath: `inset(${r.top - P.top}px ${P.right - r.right}px ${P.bottom - r.bottom}px ${r.left - P.left}px round 14px)`, opacity: 0.3 },
      ], { duration: 340, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
    } else {
      anim = card.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(16px) scale(.98)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' });
    }
    el.querySelector('.peek-scrim').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    await anim.finished.catch(() => {});
  }
  el.hidden = true;
  el.innerHTML = '';
  S.peek = null;
}

function peekInner(it) {
  const list = S.peek.list;
  const idx = list.indexOf(it.id);
  const sel = S.selected.has(it.id);
  return `
    <div class="peek-bar">
      <button class="icon" data-act="close" title="Close (Esc)">${ICON.close}</button>
      ${list.length > 1 && idx >= 0 ? `<div class="peek-nav"><button class="icon" data-act="prev" title="Previous (K)">${ICON.left}</button><span>${idx + 1} of ${list.length}</span><button class="icon" data-act="next" title="Next (J)">${ICON.right}</button></div>` : ''}
      <div class="grow"></div>
      <button class="icon" data-act="popout" title="Open in a larger window">${ICON.popout}</button>
      <a class="icon" href="${esc(it.url)}" target="_blank" rel="noopener" title="Open original">${ICON.external}</a>
    </div>
    <div class="peek-scroll">
      ${(it.media || []).length ? `<div class="peek-media">${mediaSlidesHTML(it)}</div>` : ''}
      ${peekBodyHTML(it, { inBasket: inBasket(it.id), hasKey: !!S.settings.geminiKey })}
    </div>
    ${S.selecting ? `<div class="peek-select"><button class="btn big ${sel ? 'on' : ''}" data-act="toggle-select">${sel ? ICON.check + '<span>Selected</span>' : ICON.plus + '<span>Select</span>'}</button><small>J and K to move, S to select</small></div>` : ''}`;
}

function wirePeek(root) {
  hydrateMedia(root);
  observeImages(root);
  wireSegs(root);
}

function openPeek(id, fromEl, list) {
  const it = S.byId.get(id);
  if (!it) return;
  S.peek = { id, list: list || currentListIds() };
  items.patch(id, { lastOpened: Date.now() }).catch(() => {});
  const el = openLayer(`<div class="peek-scrim" data-act="close"></div><div class="peek-card" role="dialog" aria-modal="true" aria-label="${esc(itemTitle(it))}">${peekInner(it)}</div>`, fromEl);
  wirePeek(el);
  el.querySelector('[data-act=close]')?.focus({ preventScroll: true });
}

function stepPeek(d) {
  if (!S.peek?.list?.length) return;
  const i = S.peek.list.indexOf(S.peek.id);
  const nid = S.peek.list[(i + d + S.peek.list.length) % S.peek.list.length];
  const it = S.byId.get(nid);
  if (!it) return;
  S.peek.id = nid;
  const card = $('#peek .peek-card');
  card.querySelectorAll('video').forEach(v => v.pause());
  card.innerHTML = peekInner(it);
  wirePeek(card);
  if (!reduced) card.querySelector('.peek-scroll').animate([{ transform: `translateX(${d * 36}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: SPRING });
  $(`#spaceView [data-id="${CSS.escape(nid)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function refreshPeekBody() {
  if (!S.peek?.id) return;
  const it = S.byId.get(S.peek.id);
  const pb = $('#peek .pb');
  if (!it || !pb) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = peekBodyHTML(it, { inBasket: inBasket(it.id), hasKey: !!S.settings.geminiKey });
  pb.replaceWith(tmp.firstElementChild);
  const root = $('#peek .peek-card');
  observeImages(root);
  wireSegs(root);
}

function popOut(id) {
  chrome.windows.create({ url: chrome.runtime.getURL(`preview/preview.html?id=${encodeURIComponent(id)}`), type: 'popup', width: 1120, height: 780 });
}

async function deleteItem(id) {
  const it = S.byId.get(id);
  if (!it) return;
  for (const m of it.media || []) { if (m.thumbKey) await blobs.del(m.thumbKey); if (m.fullKey) await blobs.del(m.fullKey); }
  if (it.author?.avatarKey) await blobs.del(it.author.avatarKey);
  await items.del(id);
  await removeFromBasket(id);
  S.selected.delete(id);
  await loadItems();
  renderSpace();
}

async function onPeekClick(e) {
  const t = e.target.closest('[data-act], .cite');
  if (!t) return;
  if (t.classList.contains('cite')) { openPeek(t.dataset.id); return; }
  const act = t.dataset.act;
  const id = S.peek?.id;
  const it = id && S.byId.get(id);
  switch (act) {
    case 'close': closeLayer(); break;
    case 'prev': stepPeek(-1); break;
    case 'next': stepPeek(1); break;
    case 'popout': if (id) popOut(id); break;
    case 'basket':
      if (!id) break;
      if (inBasket(id)) await removeFromBasket(id); else await addToBasket({ id, kind: 'item' });
      break;
    case 'pin':
      if (!it) break;
      await items.patch(id, x => ({ ...x, pinned: !x.pinned }));
      scheduleReload();
      break;
    case 'ask':
      if (!it) break;
      S.mentions = [{ kind: 'item', id, label: itemTitle(it) }];
      renderCtx();
      await closeLayer();
      $('#input').placeholder = 'Ask about this save';
      $('#input').focus();
      break;
    case 'reindex':
      if (!id) break;
      if (!S.settings.geminiKey) { openSettings(); break; }
      await chrome.runtime.sendMessage({ type: 'item:reindex', id });
      toast('Re-indexing with Gemini');
      break;
    case 'settings': closeLayer(); openSettings(); break;
    case 'delete':
      if (t.dataset.confirm) { await closeLayer(); await deleteItem(id); toast('Deleted'); }
      else { t.dataset.confirm = '1'; t.querySelector('span').textContent = 'Click again to delete'; setTimeout(() => { if (t.isConnected) { delete t.dataset.confirm; t.querySelector('span').textContent = 'Delete'; } }, 3000); }
      break;
    case 'toggle-select': toggleSelected(id); stepPeekRefreshSelect(); break;
    case 'plan-md': downloadPlan(S.peek.plan); break;
    case 'plan-del':
      if (t.dataset.confirm) { await plansDB.del(S.peek.plan.id); await closeLayer(); await loadPlans(); renderSpace(); toast('Plan deleted'); }
      else { t.dataset.confirm = '1'; t.title = 'Click again to delete'; t.classList.add('danger-on'); }
      break;
  }
}
function stepPeekRefreshSelect() {
  const b = $('#peek [data-act=toggle-select]');
  if (!b || !S.peek) return;
  const sel = S.selected.has(S.peek.id);
  b.classList.toggle('on', sel);
  b.innerHTML = sel ? ICON.check + '<span>Selected</span>' : ICON.plus + '<span>Select</span>';
}

// ---------------------------------------------------------------------------
// Select mode
// ---------------------------------------------------------------------------
function toggleSelect(on = !S.selecting) {
  S.selecting = on;
  if (!on) S.selected.clear();
  document.body.classList.toggle('selecting', on);
  $('#selectBar').hidden = !on;
  updateSelBar();
  renderHeadActions();
  $$('#feed .card.is-sel').forEach(c => { if (!S.selected.has(c.dataset.id)) c.classList.remove('is-sel'); });
}
function toggleSelected(id) {
  if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
  $(`#feed .card[data-id="${CSS.escape(id)}"]`)?.classList.toggle('is-sel', S.selected.has(id));
  updateSelBar();
}
function updateSelBar() {
  const n = S.selected.size;
  $('#selCount').textContent = n ? `${n} selected` : 'Click the circle on a save to select it, or open it to preview';
  $('#selAdd').disabled = !n; $('#selAsk').disabled = !n;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
function openPlan(id, fromEl) {
  const p = S.plans.find(x => x.id === id);
  if (!p) return;
  S.peek = { plan: p, planEl: fromEl };
  const thumbs = (p.itemIds || []).map(i => S.byId.get(i)).filter(Boolean);
  const el = openLayer(`
    <div class="peek-scrim" data-act="close"></div>
    <div class="peek-card plan-reader" role="dialog" aria-modal="true" aria-label="${esc(p.title)}">
      <div class="peek-bar">
        <button class="icon" data-act="close" title="Close (Esc)">${ICON.close}</button>
        <div class="grow"></div>
        <button class="icon" data-act="plan-md" title="Download as Markdown">${ICON.download}</button>
        <button class="icon" data-act="plan-del" title="Delete plan">${ICON.trash}</button>
      </div>
      <div class="peek-scroll">
        <div class="plan-hero"><h2>${esc(p.title)}</h2>${p.question ? `<p>${esc(p.question)}</p>` : ''}</div>
        ${thumbs.length ? `<div class="plan-sources-row">${thumbs.map(t => `<button class="cite" data-id="${esc(t.id)}"></button>`).join('')}</div>` : ''}
        <div class="md">${renderMarkdown(p.md, { checks: p.checks || {} })}</div>
        ${sourcesHTML(p.sources)}
      </div>
    </div>`, fromEl);
  hydrateCites(el);
}

function downloadPlan(p) {
  const md = `# ${p.title}\n\n${p.question ? `> ${p.question}\n\n` : ''}${p.md.replace(/\[\[item:([^\]\s]+)\]\]/g, (_, id) => { const it = S.byId.get(id); return it ? `[${itemTitle(it)}](${it.url})` : ''; })}\n\n## Sources\n${(p.sources || []).map(s => `- [${s.title}](${s.url})`).join('\n')}\n`;
  const url = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
  chrome.downloads.download({ url, filename: `magpie-vault/plans/${p.title.replace(/[^\w\- ]+/g, '').slice(0, 60) || 'plan'}.md`, saveAs: false });
  toast('Plan saved to Downloads/magpie-vault/plans');
}

// ---------------------------------------------------------------------------
// Ask (Dia-style: composer always at the bottom, answers slide up over saves)
// ---------------------------------------------------------------------------
function openAsk() {
  const sh = $('#askSheet');
  if (!sh.hidden) return;
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
}
function closeAsk() {
  const sh = $('#askSheet');
  if (sh.hidden) return;
  sh.classList.remove('open');
  $('#threadMenu').hidden = true;
  setTimeout(() => { if (!sh.classList.contains('open')) sh.hidden = true; }, reduced ? 0 : 380);
}

async function ensureThread(firstText) {
  if (!S.thread) {
    S.thread = { id: uid('t_'), title: clip(firstText, 60), messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    chrome.storage.local.set({ currentThread: S.thread.id });
  }
  $('#threadTitle').textContent = S.thread.title || 'New chat';
  return S.thread;
}
function newThread() {
  if (S.busy) S.abort?.abort();
  S.thread = null;
  chrome.storage.local.remove('currentThread');
  $('#threadTitle').textContent = 'New chat';
  renderThread();
  openAsk();
  $('#input').focus();
}

const SUGGESTIONS = [
  'Plan 5 days across Bangkok and Phuket from my saves. Mid-range budget, lots of street food.',
  'Which restaurants and cafes have I saved, by city?',
  'Summarize what I saved this week',
  'Make a shopping list from the products in my saves',
];

function renderThread() {
  const el = $('#thread');
  const th = S.thread;
  if (!th || !th.messages.length) {
    el.innerHTML = `<div class="ask-empty">
      <div class="ask-mark">${ICON.mark}</div>
      <h2>Ask your saves</h2>
      <p>Answers draw on the text, images and video of everything you've saved, and on the web when it helps.</p>
      <div class="suggest">${SUGGESTIONS.map(s => `<button class="sug" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </div>`;
    return;
  }
  el.innerHTML = th.messages.map(msgHTML).join('');
  hydrateCites(el);
  el.scrollTop = el.scrollHeight;
}

function sourcesHTML(sources = []) {
  if (!sources?.length) return '';
  return `<details class="sources"><summary>${sources.length} web source${sources.length === 1 ? '' : 's'}</summary><ul>${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(clip(s.title, 80))}</b><span>${esc(host(s.url))}${s.via ? `, via ${esc(s.via)}` : ''}</span></a></li>`).join('')}</ul></details>`;
}

function msgHTML(m, i) {
  if (m.role === 'user') {
    return `<div class="msg user"><div class="bubble">${esc(m.text)}</div>${m.ctx?.length ? `<div class="msg-ctx">${m.ctx.map(c => `<span class="pill sm">${esc(c)}</span>`).join('')}</div>` : ''}</div>`;
  }
  return `<div class="msg ai" data-i="${i}">
    ${m.pending ? `<div class="status-line"><i class="orb"></i><span class="st">${esc(m.status || 'Thinking')}</span><button class="link" data-act="stop">Stop</button></div>` : ''}
    <div class="md">${m.text ? renderMarkdown(m.text) : ''}</div>
    ${m.error ? `<div class="err-line">${esc(m.error)}</div>` : ''}
    ${!m.pending ? sourcesHTML(m.sources) : ''}
    ${!m.pending && (m.text || m.error) ? `<div class="msg-actions">
      ${m.text ? `<button class="btn ghost sm" data-act="save-plan" data-i="${i}">${ICON.plan}<span>Save as plan</span></button><button class="btn ghost sm" data-act="copy" data-i="${i}">${ICON.copy}<span>Copy</span></button>` : ''}
      <button class="btn ghost sm" data-act="retry" data-i="${i}">${ICON.refresh}<span>Retry</span></button></div>` : ''}
  </div>`;
}

function hydrateCites(root) {
  for (const b of root.querySelectorAll('.cite:not([data-h])')) {
    b.dataset.h = '1';
    const it = S.byId.get(b.dataset.id);
    if (!it) { b.innerHTML = '<span>save</span>'; b.disabled = true; continue; }
    b.dataset.p = it.platform;
    b.title = itemTitle(it);
    b.innerHTML = `${thumbImg(it)}<span>${esc(clip(itemTitle(it), 26))}</span>`;
  }
  observeImages(root);
}

async function resolveContext(mentions) {
  const pinned = [], platforms = new Set(), tabDocs = [];
  for (const m of mentions) {
    if (m.kind === 'item') pinned.push(S.byId.get(m.id));
    else if (m.kind === 'items') m.ids.forEach(id => pinned.push(S.byId.get(id)));
    else if (m.kind === 'space') platforms.add(m.platform);
    else if (m.kind === 'basket') {
      for (const b of S.basket) {
        if (b.kind === 'tab') tabDocs.push({ title: b.title, url: b.url, text: b.text || '' });
        else pinned.push(S.byId.get(b.id));
      }
    } else if (m.kind === 'tab') tabDocs.push(await readTab({ tabId: m.tabId, title: m.label, url: m.url }));
    else if (m.kind === 'tabs') {
      const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(t => /^https?:/.test(t.url || '')).slice(0, 8);
      tabDocs.push(...await Promise.all(tabs.map(t => readTab(t))));
    }
  }
  return { pinned: pinned.filter(Boolean), platforms: platforms.size ? [...platforms] : null, tabDocs: tabDocs.filter(t => t.text) };
}

function setBusy(on) {
  S.busy = on;
  $('#sendBtn').classList.toggle('busy', on);
  $('#sendBtn').innerHTML = on ? ICON.stop : ICON.send;
  $('#sendBtn').setAttribute('aria-label', on ? 'Stop' : 'Send');
}

async function send(textOverride) {
  if (S.busy) { S.abort?.abort(); return; }
  const input = $('#input');
  const q = (textOverride ?? input.value).trim();
  if (!q) return;
  if (!S.settings.geminiKey) { showOnboard(); return; }
  const mentions = [...S.mentions];
  const skill = S.skill;
  input.value = ''; autosize(); closePop();
  S.mentions = []; S.skill = null; renderCtx();
  input.placeholder = 'Ask your saves. Type @ to add context, / for skills';
  openAsk();

  const th = await ensureThread(q);
  const ctxLabels = [...(skill ? ['/' + skill.cmd] : []), ...mentions.map(m => m.label)];
  th.messages.push({ role: 'user', text: q, ctx: ctxLabels, mentions, skill: skill?.cmd, at: Date.now() });
  const am = { role: 'model', text: '', sources: [], itemIds: [], at: Date.now(), pending: true, status: 'Getting context' };
  th.messages.push(am);
  const idx = th.messages.length - 1;
  renderThread();
  const node = () => $(`#thread .msg.ai[data-i="${idx}"]`);
  const setStatus = s => { am.status = s; const st = node()?.querySelector('.st'); if (st) st.textContent = s; };

  let last = 0, pendingRender = 0;
  const renderBody = () => {
    const n = node();
    if (!n) return;
    n.querySelector('.md').innerHTML = renderMarkdown(am.text);
    hydrateCites(n);
    const th = $('#thread');
    if (th.scrollHeight - th.scrollTop - th.clientHeight < 160) th.scrollTop = th.scrollHeight;
  };

  S.abort = new AbortController();
  setBusy(true);
  try {
    const ctx = await resolveContext(mentions);
    const res = await ask({
      question: q,
      history: th.messages.slice(0, -2).map(m => ({ role: m.role, text: m.text })),
      ...ctx, skill, web: S.settings.web, media: S.settings.media,
      settings: S.settings, allItems: S.items, signal: S.abort.signal,
      onStatus: setStatus,
      onDelta: t => {
        am.text = t;
        const now = performance.now();
        if (now - last > 70) { last = now; renderBody(); }
        else { clearTimeout(pendingRender); pendingRender = setTimeout(renderBody, 80); }
      },
    });
    Object.assign(am, res);
  } catch (e) {
    am.error = e?.name === 'AbortError' ? 'Stopped.' : (e instanceof G.GeminiError && e.isAuth ? 'Gemini rejected the API key. Check it in Settings.' : String(e?.message || e));
  } finally {
    clearTimeout(pendingRender);
    am.pending = false;
    delete am.status;
    setBusy(false);
    th.updatedAt = Date.now();
    await threads.put(th);
    const n = node();
    if (n) { const tmp = document.createElement('div'); tmp.innerHTML = msgHTML(am, idx); n.replaceWith(tmp.firstElementChild); hydrateCites($('#thread')); }
  }
}

async function onThreadClick(e) {
  const sug = e.target.closest('[data-sug]');
  if (sug) { send(sug.dataset.sug); return; }
  const cite = e.target.closest('.cite');
  if (cite && !cite.disabled) {
    const msg = cite.closest('.msg, .md');
    const ids = [...new Set($$('.cite', msg || $('#thread')).map(c => c.dataset.id).filter(id => S.byId.has(id)))];
    openPeek(cite.dataset.id, cite, ids);
    return;
  }
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const m = S.thread?.messages[+t.dataset.i];
  if (t.dataset.act === 'stop') S.abort?.abort();
  if (t.dataset.act === 'copy' && m) {
    await navigator.clipboard.writeText(m.text.replace(/\[\[item:([^\]\s]+)\]\]/g, (_, id) => { const it = S.byId.get(id); return it ? `(${it.url})` : ''; }));
    toast('Copied');
  }
  if (t.dataset.act === 'save-plan' && m) {
    const prevUser = [...S.thread.messages.slice(0, +t.dataset.i)].reverse().find(x => x.role === 'user');
    const heading = (m.text.match(/^#{1,3}\s+(.+)$/m) || [])[1];
    const plan = { id: uid('plan_'), title: clip((heading || prevUser?.text || 'Plan').replace(/[*_#]/g, ''), 80), question: prevUser?.text || '', md: m.text, sources: m.sources || [], itemIds: m.itemIds || [], createdAt: Date.now(), checks: {}, threadId: S.thread.id };
    await plansDB.put(plan);
    await loadPlans();
    t.innerHTML = `${ICON.check}<span>Saved</span>`; t.disabled = true;
    toast('Saved to Plans', { action: { label: 'Open', run: () => { closeAsk(); setSpace('plans'); } } });
  }
  if (t.dataset.act === 'retry') {
    const i = +t.dataset.i;
    const u = S.thread.messages[i - 1];
    if (!u || u.role !== 'user') return;
    S.thread.messages.splice(i - 1, 2);
    S.mentions = u.mentions || [];
    S.skill = skills().find(s => s.cmd === u.skill) || null;
    renderCtx();
    send(u.text);
  }
}

async function showThreadMenu() {
  const menu = $('#threadMenu');
  if (!menu.hidden) { menu.hidden = true; return; }
  const list = (await threads.all()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  menu.innerHTML = list.length
    ? list.map(t => `<button class="tm-row ${S.thread?.id === t.id ? 'on' : ''}" data-tid="${esc(t.id)}"><span>${esc(t.title || 'Untitled')}</span><time>${relTime(t.updatedAt)}</time></button>`).join('')
    : '<p class="tm-empty">No earlier chats</p>';
  menu.hidden = false;
}

// ---------------------------------------------------------------------------
// Composer: @ mentions (tabs, spaces, saves, basket) and / skills
// ---------------------------------------------------------------------------
function autosize() {
  const t = $('#input');
  t.style.height = 'auto';
  t.style.height = Math.min(160, t.scrollHeight) + 'px';
}
function pillIcon(m) {
  return { item: ICON.image, items: ICON.select, space: m.platform === 'x' ? ICON.x : ICON.ig, basket: ICON.basket, tab: ICON.tab, tabs: ICON.tab }[m.kind] || ICON.spark;
}
function renderCtx() {
  const el = $('#ctxPills');
  const pills = [];
  if (S.skill) pills.push(`<span class="pill skill">${ICON.spark}<span>${esc(S.skill.name)}</span><button data-rm="skill" aria-label="Remove skill">${ICON.close}</button></span>`);
  S.mentions.forEach((m, i) => pills.push(`<span class="pill" data-k="${m.kind}">${pillIcon(m)}<span>${esc(clip(m.label, 30))}</span><button data-rm="${i}" aria-label="Remove">${ICON.close}</button></span>`));
  el.innerHTML = pills.join('');
  el.hidden = !pills.length;
}

async function popEntries(trigger, q) {
  const ql = q.toLowerCase();
  if (trigger === '/') {
    return skills().filter(s => !ql || s.cmd.startsWith(ql) || s.name.toLowerCase().includes(ql))
      .map(s => ({ kind: 'skill', skill: s, label: s.name, sub: '/' + s.cmd, icon: ICON.spark }));
  }
  const out = [
    { kind: 'basket', label: 'Basket', sub: `${S.basket.length} item${S.basket.length === 1 ? '' : 's'}`, icon: ICON.basket },
    { kind: 'space', platform: 'x', label: 'X bookmarks', sub: 'Only search X saves', icon: ICON.x },
    { kind: 'space', platform: 'instagram', label: 'Instagram saves', sub: 'Only search Instagram saves', icon: ICON.ig },
    { kind: 'tabs', label: 'All open tabs', sub: 'Read every tab in this window', icon: ICON.tab },
  ].filter(f => !ql || f.label.toLowerCase().includes(ql));
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    out.push(...tabs.filter(t => /^https?:/.test(t.url || '') && (!ql || (t.title || '').toLowerCase().includes(ql) || (t.url || '').includes(ql)))
      .slice(0, 6).map(t => ({ kind: 'tab', tabId: t.id, label: t.title || t.url, url: t.url, sub: host(t.url), icon: ICON.tab })));
  } catch {}
  if (ql.length >= 2) {
    const sc = bm25(S.items, q);
    [...sc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([id]) => {
      const it = S.byId.get(id);
      out.push({ kind: 'item', id, label: itemTitle(it), sub: `${platformName(it.platform)} save`, icon: platformIcon(it.platform) });
    });
  }
  return out.slice(0, 14);
}

async function onComposerInput() {
  autosize();
  const input = $('#input');
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/(^|\s)([@/])([^\s@/]*)$/);
  if (!m) { closePop(); return; }
  const token = { trigger: m[2], q: m[3], start: before.length - m[3].length - 1, end: before.length };
  const entries = await popEntries(token.trigger, token.q);
  if (!entries.length) { closePop(); return; }
  S.pop = { ...token, entries };
  S.popSel = 0;
  renderPop();
}
function renderPop() {
  const pop = $('#pop');
  const { entries } = S.pop;
  const groups = S.pop.trigger === '/' ? [['Skills', entries]] : [
    ['Context', entries.filter(e => ['basket', 'space', 'tabs'].includes(e.kind))],
    ['Open tabs', entries.filter(e => e.kind === 'tab')],
    ['Saves', entries.filter(e => e.kind === 'item')],
  ].filter(g => g[1].length);
  let n = 0;
  pop.innerHTML = groups.map(([label, list]) => `<div class="pop-group"><div class="pop-label">${label}</div>${list.map(e => {
    const i = entries.indexOf(e);
    n++;
    return `<button class="pop-row ${i === S.popSel ? 'on' : ''}" data-pi="${i}" role="option" aria-selected="${i === S.popSel}">${e.icon}<span class="pr-main"><b>${esc(clip(e.label, 52))}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span></button>`;
  }).join('')}</div>`).join('');
  const r = $('#composer').getBoundingClientRect();
  pop.style.bottom = (innerHeight - r.top + 8) + 'px';
  if (pop.hidden) {
    pop.hidden = false;
    if (!reduced) pop.animate([{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SPRING });
  }
  pop.querySelector('.pop-row.on')?.scrollIntoView({ block: 'nearest' });
}
function closePop() { $('#pop').hidden = true; S.pop = null; }

function pickPop(i) {
  const e = S.pop?.entries[i];
  if (!e) return;
  // Permission prompt must happen inside the user gesture, before any await.
  if (e.kind === 'tab' || e.kind === 'tabs') {
    chrome.permissions.request({ origins: ['<all_urls>'] }).then(ok => { if (!ok) toast('Magpie needs page access to read tabs'); }).catch(() => {});
  }
  const input = $('#input');
  input.value = input.value.slice(0, S.pop.start) + input.value.slice(S.pop.end);
  input.setSelectionRange(S.pop.start, S.pop.start);
  if (e.kind === 'skill') S.skill = e.skill;
  else if (!S.mentions.some(m => m.kind === e.kind && (m.id || m.tabId || m.platform) === (e.id || e.tabId || e.platform))) {
    S.mentions.push({ kind: e.kind, id: e.id, tabId: e.tabId, platform: e.platform, url: e.url, label: e.label });
  }
  closePop();
  renderCtx();
  autosize();
  input.focus();
}

function onComposerKey(e) {
  if (S.pop && !$('#pop').hidden) {
    if (e.key === 'ArrowDown') { e.preventDefault(); S.popSel = (S.popSel + 1) % S.pop.entries.length; renderPop(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); S.popSel = (S.popSel - 1 + S.pop.entries.length) % S.pop.entries.length; renderPop(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickPop(S.popSel); return; }
    if (e.key === 'Escape') { e.preventDefault(); closePop(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  if (e.key === 'Backspace' && !$('#input').value && (S.mentions.length || S.skill)) {
    if (S.mentions.length) S.mentions.pop(); else S.skill = null;
    renderCtx();
  }
}

// ---------------------------------------------------------------------------
// Command bar (Arc's ⌘T / ⌘K)
// ---------------------------------------------------------------------------
const COMMANDS = () => [
  ...SPACES.map((s, i) => ({ label: `Go to ${s.name}`, hint: `${isMac ? '⌥' : 'Alt+'}${i + 1}`, icon: ICON[s.icon], run: () => setSpace(s.id) })),
  { label: 'Crawl the bookmarks page in this tab', icon: ICON.crawl, run: () => crawlActiveTab() },
  { label: 'Open X bookmarks and crawl', icon: ICON.x, run: () => openAndCrawl('x') },
  { label: 'Open Instagram saved and crawl', icon: ICON.ig, run: () => openAndCrawl('instagram') },
  { label: 'Add this tab to basket', icon: ICON.basket, run: () => addActiveTab() },
  { label: 'New chat', icon: ICON.plus, run: () => newThread() },
  { label: 'Select saves', icon: ICON.select, run: () => toggleSelect(true) },
  { label: 'Export vault as JSON', icon: ICON.download, run: () => exportVault(false) },
  { label: 'Settings', icon: ICON.gear, run: () => openSettings() },
  { label: 'Switch theme', icon: ICON.spark, run: () => cycleTheme() },
];

function openPalette() {
  const p = $('#palette');
  p.hidden = false;
  $('#paletteInput').value = '';
  renderPalette('');
  $('#paletteInput').focus();
  if (!reduced) {
    p.querySelector('.palette-card').animate([{ opacity: 0, transform: 'translateY(-10px) scale(.97)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 360, easing: SPRING });
    p.querySelector('.palette-scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }
}
function closePalette() { $('#palette').hidden = true; }

function renderPalette(q) {
  const rows = [];
  const ql = q.trim().toLowerCase();
  if (ql) rows.push({ label: `Ask “${q.trim()}”`, sub: 'Answer from your saves and the web', icon: ICON.spark, run: () => send(q.trim()) });
  const cmds = COMMANDS().filter(c => !ql || ql.split(/\s+/).every(w => c.label.toLowerCase().includes(w)));
  rows.push(...cmds.slice(0, ql ? 5 : 14));
  if (ql.length >= 2) {
    const sc = bm25(S.items, q);
    [...sc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([id]) => {
      const it = S.byId.get(id);
      rows.push({ label: itemTitle(it), sub: `${platformName(it.platform)}${it.author?.handle ? ' post by @' + it.author.handle : ''}`, item: it, run: () => openPeek(id, null, [...sc.keys()]) });
    });
  }
  S.palRows = rows;
  S.palSel = 0;
  drawPalette();
}
function drawPalette() {
  const list = $('#paletteList');
  list.innerHTML = S.palRows.length ? S.palRows.map((r, i) => `
    <button class="pal-row ${i === S.palSel ? 'on' : ''}" data-pi="${i}" role="option" aria-selected="${i === S.palSel}">
      <span class="pal-ico">${r.item ? thumbImg(r.item) : r.icon}</span>
      <span class="pal-main"><b>${esc(clip(r.label, 70))}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span>
      ${r.hint ? `<kbd>${r.hint}</kbd>` : ''}
    </button>`).join('') : '<p class="pal-empty">No matches. Press Enter to ask anyway.</p>';
  observeImages(list);
  list.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' });
}
function runPalette(i) {
  const r = S.palRows[i];
  closePalette();
  if (r) r.run();
  else { const q = $('#paletteInput').value.trim(); if (q) send(q); }
}

// ---------------------------------------------------------------------------
// Crawling helpers
// ---------------------------------------------------------------------------
const isTargetUrl = (u, p) => p === 'x' ? /^https:\/\/(x|twitter)\.com\/i\/bookmarks/.test(u) : /^https:\/\/www\.instagram\.com\/[^/]+\/saved\//.test(u);
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }

async function crawlActiveTab() {
  const t = await activeTab();
  const p = isTargetUrl(t?.url || '', 'x') ? 'x' : isTargetUrl(t?.url || '', 'instagram') ? 'instagram' : null;
  if (!p) { toast('Open your X bookmarks or an Instagram saved collection first', { action: { label: 'Open X', run: () => openAndCrawl('x') } }); return; }
  try { await chrome.tabs.sendMessage(t.id, { type: 'crawl:start' }); }
  catch { toast('Reload the page so Magpie can attach, then try again'); }
}

async function openAndCrawl(platform) {
  const t = await activeTab();
  if (t && isTargetUrl(t.url || '', platform)) return crawlActiveTab();
  await chrome.storage.local.set({ pendingCrawl: { platform, at: Date.now() } });
  let url = 'https://x.com/i/bookmarks';
  if (platform === 'instagram') {
    const { igUser } = await chrome.storage.local.get('igUser');
    url = igUser ? `https://www.instagram.com/${igUser}/saved/all-posts/` : 'https://www.instagram.com/';
    if (!igUser) toast('Open your profile, then Saved, then All posts. Crawling starts when it loads.', { ms: 7000 });
  }
  await chrome.tabs.create({ url });
}

async function addActiveTab() {
  const t = await activeTab();
  if (!t || !/^https?:/.test(t.url || '')) { toast('This tab can\'t be added'); return; }
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false) || await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
  const doc = granted ? await readTab(t) : { title: t.title, url: t.url, text: '' };
  await addToBasket({ id: 'tab:' + t.url, kind: 'tab', title: doc.title || t.title, url: t.url, text: doc.text || '' });
  toast(doc.text ? 'Tab added to basket' : 'Tab added (title only, page access was not granted)');
}

function renderCrawl() {
  const c = S.crawl;
  const strip = $('#crawlStrip');
  if (!c || c.state === 'idle') { strip.hidden = true; return; }
  const running = c.state === 'running' || c.state === 'paused';
  strip.hidden = false;
  strip.dataset.p = c.platform;
  strip.dataset.state = c.state;
  strip.innerHTML = `
    <span class="chomp ${c.state === 'running' ? 'on' : ''}" aria-hidden="true"><i></i><i></i></span>
    <span class="cs-text"><b>${running ? (c.state === 'paused' ? 'Paused' : 'Crawling') + ' ' + platformName(c.platform) : c.state === 'done' ? 'Crawl finished' : 'Crawl stopped'}</b><small>${c.count} collected, ${c.fresh} new</small></span>
    <div class="grow"></div>
    ${running ? `<button class="icon sm" data-cs="pause" title="${c.state === 'paused' ? 'Resume' : 'Pause'}">${c.state === 'paused' ? ICON.play : ICON.pause}</button><button class="icon sm" data-cs="stop" title="Stop">${ICON.stop}</button>` : `<button class="icon sm" data-cs="dismiss" title="Dismiss">${ICON.close}</button>`}`;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const fmtMB = b => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : Math.round(b / 1048576) + ' MB');

async function openSettings() {
  const el = $('#settings');
  const s = S.settings;
  const { used, quota } = await estimate();
  const softB = s.softMB * 1048576, hardB = s.hardMB * 1048576;
  const scale = Math.max(hardB * 1.1, used);
  const counts = { total: S.items.length, indexed: S.items.filter(i => i.status === 'indexed').length, archived: S.items.filter(i => i.archived).length };
  el.innerHTML = `
    <div class="set-scrim" data-close></div>
    <aside class="set-card" role="dialog" aria-label="Settings">
      <header class="set-head"><h2>Settings</h2><button class="icon" data-close aria-label="Close">${ICON.close}</button></header>
      <div class="set-body">
        <section>
          <h3>AI</h3>
          <label class="field"><span>Gemini API key</span>
            <div class="row"><input type="password" data-k="geminiKey" value="${esc(s.geminiKey)}" placeholder="AIza…" autocomplete="off"><button class="btn sm" data-verify="gemini">Check</button></div>
            <small>Indexes images and video and answers questions. Get one at aistudio.google.com. Stored only in this browser.</small></label>
          <label class="field"><span>Exa API key <em>optional</em></span>
            <div class="row"><input type="password" data-k="exaKey" value="${esc(s.exaKey)}" placeholder="For deeper web research" autocomplete="off"><button class="btn sm" data-verify="exa">Check</button></div>
            <small>Without it, answers still use Google Search through Gemini.</small></label>
          <div class="two">
            <label class="field"><span>Model</span><input data-k="model" value="${esc(s.model)}" list="modelList"></label>
            <label class="field"><span>Embedding model</span><input data-k="embedModel" value="${esc(s.embedModel)}"></label>
          </div>
          <datalist id="modelList"><option value="gemini-3.1-pro-preview"><option value="gemini-3.5-flash"><option value="gemini-3-flash-preview"><option value="gemini-2.5-pro"></datalist>
          <label class="switch"><input type="checkbox" data-k="autoIndex" ${s.autoIndex ? 'checked' : ''}><span>Index new saves automatically</span></label>
        </section>
        <section>
          <h3>Collecting</h3>
          <label class="switch"><input type="checkbox" data-k="storeMedia" ${s.storeMedia ? 'checked' : ''}><span>Keep full images and videos offline</span></label>
          <label class="field"><span>Largest video to keep offline</span><div class="row"><input type="number" min="0" max="500" data-k="maxVideoMB" value="${s.maxVideoMB}"><em class="unit">MB</em></div></label>
        </section>
        <section>
          <h3>Storage</h3>
          <div class="meter" aria-label="Storage used">
            <i class="meter-used" style="width:${Math.min(100, used / scale * 100)}%"></i>
            <i class="meter-mark soft" style="left:${softB / scale * 100}%" title="Media cleanup"></i>
            <i class="meter-mark hard" style="left:${Math.min(99.5, hardB / scale * 100)}%" title="Archive"></i>
          </div>
          <p class="meter-text">${fmtMB(used)} used of ${quota ? fmtMB(quota) : 'unknown'} available. ${counts.total} saves, ${counts.indexed} indexed${counts.archived ? `, ${counts.archived} archived` : ''}.</p>
          <div class="two">
            <label class="field"><span>Drop offline media above</span><div class="row"><input type="number" min="100" step="100" data-k="softMB" value="${s.softMB}"><em class="unit">MB</em></div></label>
            <label class="field"><span>Archive oldest saves above</span><div class="row"><input type="number" min="200" step="100" data-k="hardMB" value="${s.hardMB}"><em class="unit">MB</em></div></label>
          </div>
          <small class="note">Past the first limit, full-size media of the saves you opened least is removed; thumbnails and the AI index stay. Past the second, the oldest saves are written to Downloads/magpie-vault as JSON and kept here as searchable stubs. Import the file to bring them back.</small>
          <label class="switch"><input type="checkbox" data-k="autoSnapshot" ${s.autoSnapshot ? 'checked' : ''}><span>Keep a JSON copy of the index in Downloads/magpie-vault</span></label>
          <div class="btn-row">
            <button class="btn sm" data-do="export">${ICON.download}<span>Export vault</span></button>
            <button class="btn sm" data-do="export-thumbs">${ICON.download}<span>Export with thumbnails</span></button>
            <button class="btn sm" data-do="import">${ICON.upload}<span>Import</span></button>
            <button class="btn sm" data-do="free">${ICON.image}<span>Free up media</span></button>
            <button class="btn sm" data-do="archive">${ICON.archive}<span>Archive oldest</span></button>
          </div>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </section>
        <section>
          <h3>Skills</h3>
          <p class="note">Type / in the composer to use one. Built in: ${BUILTIN_SKILLS.map(k => '/' + k.cmd).join(', ')}.</p>
          <div class="skill-list">${(s.skills || []).map((k, i) => `<div class="skill-row"><b>/${esc(k.cmd)}</b><span>${esc(k.name)}</span><button class="icon sm" data-rmskill="${i}" aria-label="Remove">${ICON.trash}</button></div>`).join('')}</div>
          <div class="skill-form">
            <div class="two"><input id="skCmd" placeholder="command, e.g. dates"><input id="skName" placeholder="Name, e.g. Date night ideas"></div>
            <textarea id="skPrompt" rows="2" placeholder="Instructions, e.g. Suggest three date nights from my food and bar saves with booking links"></textarea>
            <button class="btn sm" data-do="add-skill">${ICON.plus}<span>Add skill</span></button>
          </div>
        </section>
        <section>
          <h3>Appearance</h3>
          <div class="seg-ctl" role="radiogroup">${['system', 'light', 'dark'].map(t => `<button role="radio" aria-checked="${s.theme === t}" data-theme-set="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
        </section>
      </div>
    </aside>`;
  el.hidden = false;
  if (!reduced) {
    el.querySelector('.set-card').animate([{ transform: 'translateX(40px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 440, easing: SPRING });
    el.querySelector('.set-scrim').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
  }
}
function closeSettings() { $('#settings').hidden = true; }

async function onSettingsChange(e) {
  const k = e.target.dataset.k;
  if (!k) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? +e.target.value : e.target.value.trim();
  S.settings = await setSettings({ [k]: v });
  if (k === 'geminiKey' && v) chrome.runtime.sendMessage({ type: 'queue:kick' });
}

async function onSettingsClick(e) {
  if (e.target.closest('[data-close]')) { closeSettings(); return; }
  const v = e.target.closest('[data-verify]');
  if (v) {
    const which = v.dataset.verify;
    const key = $(`#settings [data-k="${which === 'gemini' ? 'geminiKey' : 'exaKey'}"]`).value.trim();
    v.textContent = 'Checking…';
    try {
      if (which === 'gemini') {
        const models = await G.verifyKey(key);
        const has = models.includes(S.settings.model);
        v.textContent = has ? 'Works' : 'Key works';
        if (!has) toast(`Key works, but "${S.settings.model}" isn't listed for it. Try another model.`, { ms: 6000 });
      } else { await verifyExa(key); v.textContent = 'Works'; }
      v.classList.add('ok');
    } catch (err) { v.textContent = 'Failed'; v.classList.add('bad'); toast(String(err.message || err).slice(0, 140)); }
    return;
  }
  const t = e.target.closest('[data-theme-set]');
  if (t) { S.settings = await setSettings({ theme: t.dataset.themeSet }); applyTheme(); $$('#settings [data-theme-set]').forEach(b => b.setAttribute('aria-checked', b === t)); return; }
  const rm = e.target.closest('[data-rmskill]');
  if (rm) { const sk = [...(S.settings.skills || [])]; sk.splice(+rm.dataset.rmskill, 1); S.settings = await setSettings({ skills: sk }); openSettings(); return; }
  const d = e.target.closest('[data-do]');
  if (!d) return;
  switch (d.dataset.do) {
    case 'export': exportVault(false); break;
    case 'export-thumbs': exportVault(true); break;
    case 'import': $('#importFile').click(); break;
    case 'free': { const r = await chrome.runtime.sendMessage({ type: 'guard:run', mode: 'media' }); toast(`Removed offline media from ${r?.evicted || 0} saves`); openSettings(); break; }
    case 'archive': { const r = await chrome.runtime.sendMessage({ type: 'guard:run', mode: 'archive' }); toast(`Archived ${r?.archived || 0} saves to Downloads/magpie-vault`); openSettings(); break; }
    case 'add-skill': {
      const cmd = $('#skCmd').value.trim().replace(/^\//, '').toLowerCase().replace(/[^\w-]/g, '');
      const name = $('#skName').value.trim(), prompt = $('#skPrompt').value.trim();
      if (!cmd || !prompt) { toast('Add a command and instructions'); return; }
      S.settings = await setSettings({ skills: [...(S.settings.skills || []), { cmd, name: name || cmd, prompt }] });
      openSettings();
      toast(`Added /${cmd}`);
      break;
    }
  }
}

async function exportVault(withThumbs) {
  const all = await items.all();
  const payload = { magpie: 1, kind: 'vault', exportedAt: new Date().toISOString(), items: all, plans: await plansDB.all(), basket: S.basket };
  if (withThumbs) {
    payload.blobs = {};
    for (const it of all) {
      const keys = [...(it.media || []).map(m => m.thumbKey), it.author?.avatarKey].filter(Boolean);
      for (const k of keys) { const b = await blobs.get(k); if (b) payload.blobs[k] = { type: b.type, data: await blobToBase64(b) }; }
    }
  }
  await downloadJSON(payload, `magpie-vault/vault-${new Date().toISOString().slice(0, 10)}.json`);
  toast('Saved to Downloads/magpie-vault');
}

async function importVault(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j?.magpie || !Array.isArray(j.items)) throw new Error('This isn\'t a Magpie vault or archive file');
    let n = 0;
    for (const it of j.items) {
      const ex = await items.get(it.id);
      if (!ex || ex.archived) { const { archived, ...rest } = it; await items.put({ ...rest, updatedAt: Date.now() }); n++; }
    }
    for (const [k, v] of Object.entries(j.blobs || {})) await blobs.put(k, base64ToBlob(v.data, v.type));
    for (const p of j.plans || []) await plansDB.put(p);
    await loadItems(); await loadPlans(); renderSpace();
    toast(`Imported ${n} save${n === 1 ? '' : 's'}`);
  } catch (e) { toast(String(e.message || e)); }
}

function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
async function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  S.settings = await setSettings({ theme: order[(order.indexOf(S.settings.theme) + 1) % 3] });
  applyTheme();
  toast(`Theme: ${S.settings.theme}`);
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
function showOnboard() {
  const el = $('#onboard');
  el.innerHTML = `
    <div class="ob-card">
      <div class="ob-mark">${ICON.mark}</div>
      <h1>Magpie</h1>
      <p class="ob-lede">Collect your X bookmarks and Instagram saves, let Gemini read their images and video, then turn them into plans.</p>
      <label class="field"><span>Gemini API key</span><input id="obKey" type="password" placeholder="AIza…" autocomplete="off" value="${esc(S.settings.geminiKey || '')}"></label>
      <small class="ob-small">Create one at aistudio.google.com/apikey. It stays in this browser and is only sent to Google.</small>
      <details class="ob-more"><summary>Add an Exa key for deeper web research</summary><input id="obExa" type="password" placeholder="Exa API key (optional)" autocomplete="off" value="${esc(S.settings.exaKey || '')}"></details>
      <button class="btn primary big" id="obSave">${ICON.check}<span>Save key and start</span></button>
      <button class="link" id="obSkip">Collect without AI for now</button>
      <p class="ob-err" id="obErr" hidden></p>
    </div>`;
  el.hidden = false;
  if (!reduced) el.querySelector('.ob-card').animate([{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: SPRING });
  $('#obKey').focus();
  $('#obSkip').onclick = async () => { S.settings = await setSettings({ onboarded: true }); hideOnboard(); };
  $('#obSave').onclick = async () => {
    const key = $('#obKey').value.trim();
    const exa = $('#obExa').value.trim();
    const err = $('#obErr');
    if (!key) { err.hidden = false; err.textContent = 'Paste your Gemini key, or choose to collect without AI.'; return; }
    $('#obSave span').textContent = 'Checking key…';
    try {
      await G.verifyKey(key);
      S.settings = await setSettings({ geminiKey: key, exaKey: exa, onboarded: true });
      chrome.runtime.sendMessage({ type: 'queue:kick' });
      hideOnboard();
      toast('Key saved. Indexing will start in the background.');
    } catch (e) {
      err.hidden = false;
      err.textContent = `Gemini didn't accept that key: ${String(e.message || e).slice(0, 120)}`;
      $('#obSave span').textContent = 'Save key and start';
    }
  };
}
function hideOnboard() {
  const el = $('#onboard');
  if (reduced) { el.hidden = true; return; }
  el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' }).finished.then(() => { el.hidden = true; el.getAnimations().forEach(a => a.cancel()); });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wireStatic() {
  $('#markBtn').innerHTML = ICON.mark;
  $('.cmd-ico').innerHTML = ICON.search;
  $('#cmdKbd').textContent = isMac ? '⌘K' : 'Ctrl K';
  $('#settingsBtn').innerHTML = ICON.gear;
  $('#newChatBtn').innerHTML = ICON.plus;
  $('#closeAskBtn').innerHTML = ICON.down;
  $('.tb-ico').innerHTML = ICON.history;
  $('#selAsk').innerHTML = `${ICON.spark}<span>Ask</span>`;
  $('#selAdd').innerHTML = `${ICON.basket}<span>Add to basket</span>`;
  $('#selDone').innerHTML = ICON.close;
  $('#webToggle').innerHTML = `${ICON.web}<span>Web</span>`;
  $('#mediaToggle').innerHTML = `${ICON.image}<span>Media</span>`;
  $('#sendBtn').innerHTML = ICON.send;
  $('.pi-ico').innerHTML = ICON.search;
  syncToggles();
}
function syncToggles() {
  $('#webToggle').setAttribute('aria-pressed', String(!!S.settings.web));
  $('#mediaToggle').setAttribute('aria-pressed', String(!!S.settings.media));
}

function wire() {
  $('#markBtn').onclick = () => setSpace('all');
  $('#cmdBtn').onclick = openPalette;
  $('#settingsBtn').onclick = openSettings;
  $('#newChatBtn').onclick = newThread;
  $('#closeAskBtn').onclick = closeAsk;
  $('#threadBtn').onclick = showThreadMenu;
  $('#threadMenu').onclick = async e => {
    const r = e.target.closest('[data-tid]');
    if (!r) return;
    S.thread = await threads.get(r.dataset.tid);
    chrome.storage.local.set({ currentThread: S.thread.id });
    $('#threadTitle').textContent = S.thread.title || 'Chat';
    $('#threadMenu').hidden = true;
    renderThread();
  };
  $('#thread').addEventListener('click', onThreadClick);
  $('#spaces').addEventListener('click', e => { const b = e.target.closest('.sp'); if (b) setSpace(b.dataset.space); });

  // Drag a card onto the basket in the dock
  const basketBtn = () => $('#spaces .sp[data-space="basket"]');
  $('#spaces').addEventListener('dragover', e => { if (e.target.closest('.sp[data-space="basket"]')) { e.preventDefault(); basketBtn().classList.add('drop'); } });
  $('#spaces').addEventListener('dragleave', () => basketBtn()?.classList.remove('drop'));
  $('#spaces').addEventListener('drop', async e => {
    const b = e.target.closest('.sp[data-space="basket"]');
    basketBtn()?.classList.remove('drop');
    if (!b) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/x-magpie');
    const ids = S.selected.has(id) ? [...S.selected] : [id];
    const n = await addToBasket(ids.map(x => ({ id: x, kind: 'item' })));
    toast(n ? `${n} added to basket` : 'Already in basket');
  });
  document.addEventListener('dragstart', e => {
    const c = e.target.closest?.('.card[data-id]');
    if (!c) return;
    e.dataTransfer.setData('text/x-magpie', c.dataset.id);
    e.dataTransfer.effectAllowed = 'copy';
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragend', () => document.body.classList.remove('dragging'));

  // Space view: cards, tags, header actions
  $('#spaceView').addEventListener('click', async e => {
    const tag = e.target.closest('[data-tag]');
    if (tag) { S.tag = S.tag === tag.dataset.tag ? null : tag.dataset.tag; S.limit = 60; renderSpace(); return; }
    const act = e.target.closest('[data-act]');
    const card = e.target.closest('.card[data-id], .pin-tile[data-id], .brow[data-id]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'check' && card) { if (!S.selecting) toggleSelect(true); toggleSelected(card.dataset.id); return; }
      if (a === 'select') { toggleSelect(); return; }
      if (a === 'crawl') { S.space === 'all' ? crawlActiveTab() : openAndCrawl(S.space); return; }
      if (a === 'open-x') { openAndCrawl('x'); return; }
      if (a === 'open-ig') { openAndCrawl('instagram'); return; }
      if (a === 'settings') { openSettings(); return; }
      if (a === 'clear-tag') { S.tag = null; renderSpace(); return; }
      if (a === 'ask-basket') { S.mentions = [{ kind: 'basket', label: 'Basket' }]; renderCtx(); $('#input').focus(); return; }
      if (a === 'add-tab') { addActiveTab(); return; }
      if (a === 'clear-basket') { await setBasket([]); return; }
      if (a === 'unbasket') { await removeFromBasket(act.dataset.bid); return; }
    }
    const plan = e.target.closest('.plan-card');
    if (plan) { openPlan(plan.dataset.plan, plan); return; }
    const tabRow = e.target.closest('.brow[data-url]:not([data-id])');
    if (tabRow) { chrome.tabs.create({ url: tabRow.dataset.url }); return; }
    if (card) {
      if (S.selecting && (e.shiftKey || e.metaKey || e.ctrlKey)) { toggleSelected(card.dataset.id); return; }
      openPeek(card.dataset.id, card);
    }
  });
  $('#spaceView').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.card[data-id], .plan-card');
    if (!card || e.target !== card) return;
    e.preventDefault();
    card.classList.contains('plan-card') ? openPlan(card.dataset.plan, card) : openPeek(card.dataset.id, card);
  });
  $('#spaceSub').addEventListener('click', e => { if (e.target.closest('[data-act=settings]')) openSettings(); });

  // Infinite scroll
  new IntersectionObserver(es => {
    if (es[0].isIntersecting && $('#sentinel').dataset.more) { S.limit += 60; renderSpace(); }
  }, { root: $('#stage'), rootMargin: '600px' }).observe($('#sentinel'));

  // Peek
  $('#peek').addEventListener('click', onPeekClick);
  $('#peek').addEventListener('change', async e => {
    const cb = e.target.closest('input[data-task]');
    if (!cb || !S.peek?.plan) return;
    S.peek.plan.checks = { ...(S.peek.plan.checks || {}), [cb.dataset.task]: cb.checked };
    await plansDB.put(S.peek.plan);
    await loadPlans();
    if (S.space === 'plans') renderPlans();
  });

  // Select bar
  $('#selDone').onclick = () => toggleSelect(false);
  $('#selAdd').onclick = async () => {
    const n = await addToBasket([...S.selected].map(id => ({ id, kind: 'item' })));
    toast(`${n} added to basket`, { action: { label: 'Open basket', run: () => setSpace('basket') } });
    S.selected.clear(); $$('#feed .card.is-sel').forEach(c => c.classList.remove('is-sel')); updateSelBar();
  };
  $('#selAsk').onclick = () => {
    const ids = [...S.selected];
    S.mentions = ids.length <= 4 ? ids.map(id => ({ kind: 'item', id, label: itemTitle(S.byId.get(id)) })) : [{ kind: 'items', ids, label: `${ids.length} selected saves` }];
    toggleSelect(false); renderCtx(); $('#input').focus();
  };

  // Composer
  const input = $('#input');
  input.addEventListener('input', onComposerInput);
  input.addEventListener('keydown', onComposerKey);
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) closePop(); }, 150));
  $('#pop').addEventListener('mousedown', e => e.preventDefault());
  $('#pop').addEventListener('click', e => { const r = e.target.closest('[data-pi]'); if (r) pickPop(+r.dataset.pi); });
  $('#ctxPills').addEventListener('click', e => {
    const r = e.target.closest('[data-rm]');
    if (!r) return;
    if (r.dataset.rm === 'skill') S.skill = null; else S.mentions.splice(+r.dataset.rm, 1);
    renderCtx();
  });
  $('#sendBtn').onclick = () => send();
  $('#webToggle').onclick = async () => { S.settings = await setSettings({ web: !S.settings.web }); syncToggles(); };
  $('#mediaToggle').onclick = async () => { S.settings = await setSettings({ media: !S.settings.media }); syncToggles(); };

  // Palette
  $('#paletteInput').addEventListener('input', e => renderPalette(e.target.value));
  $('#paletteInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); S.palSel = Math.min(S.palRows.length - 1, S.palSel + 1); drawPalette(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); S.palSel = Math.max(0, S.palSel - 1); drawPalette(); }
    if (e.key === 'Enter') { e.preventDefault(); runPalette(S.palSel); }
  });
  $('#palette').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closePalette(); return; }
    const r = e.target.closest('[data-pi]');
    if (r) runPalette(+r.dataset.pi);
  });

  // Settings
  $('#settings').addEventListener('change', e => {
    if (e.target.id === 'importFile' && e.target.files[0]) { importVault(e.target.files[0]); return; }
    onSettingsChange(e);
  });
  $('#settings').addEventListener('click', onSettingsClick);

  // Crawl strip
  $('#crawlStrip').addEventListener('click', async e => {
    const b = e.target.closest('[data-cs]');
    if (!b || !S.crawl) return;
    if (b.dataset.cs === 'dismiss') { S.crawl = null; renderCrawl(); return; }
    try { await chrome.tabs.sendMessage(S.crawl.tabId, { type: `crawl:${b.dataset.cs}` }); } catch {}
  });

  // Global keys
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
    if (e.key === 'Escape') {
      if (!$('#palette').hidden) return closePalette();
      if (!$('#pop').hidden) return closePop();
      if (!$('#onboard').hidden) return;
      if (!$('#peek').hidden) return closeLayer();
      if (!$('#settings').hidden) return closeSettings();
      if (!$('#askSheet').hidden) return closeAsk();
      if (S.selecting) return toggleSelect(false);
    }
    if (e.altKey && /^Digit[1-5]$/.test(e.code)) { e.preventDefault(); setSpace(SPACES[+e.code.slice(-1) - 1].id); return; }
    if (!$('#peek').hidden && S.peek?.id && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepPeek(1); }
      if (k === 'k' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepPeek(-1); }
      if (k === 's' && S.selecting) { toggleSelected(S.peek.id); stepPeekRefreshSelect(); }
      if (k === 'b') $('#peek [data-act=basket]')?.click();
      return;
    }
    if (!typing && e.key === '/' && $('#peek').hidden) { e.preventDefault(); $('#input').focus(); }
  });

  // Two-finger horizontal swipe between spaces, with rubber-band follow
  let acc = 0, swT = 0;
  $('#stage').addEventListener('wheel', e => {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.3 || Math.abs(e.deltaX) < 2) return;
    e.preventDefault();
    acc += e.deltaX;
    const v = $('#spaceView');
    v.style.transition = 'none';
    v.style.transform = `translateX(${-Math.sign(acc) * Math.min(64, Math.abs(acc) * 0.35)}px)`;
    clearTimeout(swT);
    swT = setTimeout(() => {
      const go = Math.abs(acc) > 110, dir = Math.sign(acc);
      acc = 0;
      v.style.transition = `transform .5s ${SPRING}`;
      v.style.transform = '';
      if (go) stepSpace(dir);
    }, 120);
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Live updates
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'items:changed') scheduleReload();
  if (msg?.type === 'queue:status') { S.queue = msg; renderSub(); }
  if (msg?.type === 'crawl:progress' && sender.tab) { S.crawl = { ...msg, tabId: sender.tab.id }; renderCrawl(); }
});
chrome.storage.onChanged.addListener(c => {
  if (c.basket) {
    S.basket = c.basket.newValue || [];
    updateNav();
    if (S.space === 'basket') renderSpace();
    else renderSub();
    if (S.peek?.id) refreshPeekBody();
  }
  if (c.settings) { S.settings = { ...S.settings, ...(c.settings.newValue || {}) }; syncToggles(); }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  S.settings = await getSettings();
  applyTheme();
  wireStatic();
  S.basket = await getBasket();
  await Promise.all([loadItems(), loadPlans()]);
  const { ui, currentThread } = await chrome.storage.local.get(['ui', 'currentThread']);
  S.space = ui?.space && SPACES.some(s => s.id === ui.space) ? ui.space : 'all';
  document.documentElement.dataset.space = S.space;
  renderSpacesNav();
  wire();
  renderSpace();
  if (currentThread) {
    S.thread = await threads.get(currentThread) || null;
    if (S.thread) $('#threadTitle').textContent = S.thread.title || 'Chat';
  }
  renderThread();
  try { S.queue = await chrome.runtime.sendMessage({ type: 'queue:status' }) || {}; renderSub(); } catch {}
  if (!S.settings.geminiKey && !S.settings.onboarded) showOnboard();
})();
