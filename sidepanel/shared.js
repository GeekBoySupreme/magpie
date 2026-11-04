import { blobs } from '../lib/db.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sv = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
// Two-tone detail: a soft fill under the outline.
const tone = d => `<path d="${d}" fill="currentColor" fill-opacity=".2" stroke="none"/>`;
const dot = (cx, cy, r = 1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
export const ICON = {
  mark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.3L5 21V4.5A1.5 1.5 0 0 1 6.5 3z" fill="currentColor"/><circle cx="14.6" cy="8.4" r="1.5" fill="var(--mark-eye, #15121b)"/></svg>',
  spark: sv(tone('M10 3.5l1.9 5.1 5.1 1.9-5.1 1.9L10 17.5l-1.9-5.1L3 10.5l5.1-1.9z') + '<path d="M10 3.5l1.9 5.1 5.1 1.9-5.1 1.9L10 17.5l-1.9-5.1L3 10.5l5.1-1.9z"/><path d="M18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>' + dot(18.5, 4.5, 1.1)),
  x: '<svg class="bird" viewBox="32 0 576 576" width="18" height="18" aria-hidden="true"><ellipse class="bird-ring" cx="420" cy="70" rx="80" ry="20"/><path class="bird-path" d="M523.4 215.7C523.7 220.2 523.7 224.8 523.7 229.3C523.7 368 418.1 527.9 225.1 527.9C165.6 527.9 110.4 510.7 64 480.8C72.4 481.8 80.6 482.1 89.3 482.1C138.4 482.1 183.5 465.5 219.6 437.3C173.5 436.3 134.8 406.1 121.5 364.5C128 365.5 134.5 366.1 141.3 366.1C150.7 366.1 160.1 364.8 168.9 362.5C120.8 352.8 84.8 310.5 84.8 259.5V258.2C98.8 266 115 270.9 132.2 271.5C103.9 252.7 85.4 220.5 85.4 184.1C85.4 164.6 90.6 146.7 99.7 131.1C151.4 194.8 229 236.4 316.1 240.9C314.5 233.1 313.5 225 313.5 216.9C313.5 159.1 360.3 112 418.4 112C448.6 112 475.9 124.7 495.1 145.1C518.8 140.6 541.6 131.8 561.7 119.8C553.9 144.2 537.3 164.6 515.6 177.6C536.7 175.3 557.2 169.5 576 161.4C561.7 182.2 543.8 200.7 523.4 215.7Z"/></svg>',
  ig: sv('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17.2" cy="6.8" r=".5" fill="currentColor"/>'),
  web: sv(tone('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z') + '<circle cx="12" cy="12" r="8.5"/><path d="M3.8 9.2h16.4M3.8 14.8h16.4"/><path d="M12 3.5c2.3 2.4 3.4 5.3 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.3-3.4-8.5S9.7 5.9 12 3.5z"/>'),
  basket: sv(tone('M4 10h16l-1.6 8.4a2 2 0 0 1-2 1.6H7.6a2 2 0 0 1-2-1.6z') + '<path d="M3 10h18"/><path d="M4 10l1.6 8.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L20 10"/><path d="M8 10l3-5.5M16 10l-3-5.5"/><path d="M9.5 13.5v3M14.5 13.5v3"/>'),
  plan: sv(tone('M9 4.5l6 2 5.5-2v13L15 19.5l-6-2-5.5 2v-13z') + '<path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/><path d="M5.8 10.5l1.6.9M11.2 9.3l1.6.9" stroke-dasharray="0.1 2.6"/>' + dot(17.8, 9.8, 1.3)),
  search: sv(tone('M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6z') + '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.4 15.4l4.6 4.6"/><path d="M8 8.6a3.3 3.3 0 0 1 2.5-1.4"/>'),
  gear: sv(tone('M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z') + '<path d="M10.3 3.6h3.4l.5 2.3 1.5.9 2.2-.8 1.7 2.9-1.8 1.6v1.8l1.8 1.6-1.7 2.9-2.2-.8-1.5.9-.5 2.3h-3.4l-.5-2.3-1.5-.9-2.2.8-1.7-2.9 1.8-1.6v-1.8L4.4 8.9l1.7-2.9 2.2.8 1.5-.9z"/><circle cx="12" cy="12" r="3.2"/>'),
  close: sv('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  down: sv('<path d="M6 9.5l6 6 6-6"/>'),
  left: sv('<path d="M15 6l-6 6 6 6"/>'),
  right: sv('<path d="M9 6l6 6-6 6"/>'),
  arrow: sv('<path d="M5 12h13M13 6.5l5.5 5.5-5.5 5.5"/>'),
  popout: sv(tone('M5.5 7h9a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 17.5v-9A1.5 1.5 0 0 1 5.5 7z') + '<rect x="4" y="7" width="12" height="12" rx="2"/><path d="M12.5 3.5h8v8M20.5 3.5l-8 8"/>'),
  external: sv('<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  pin: sv(tone('M9 3.5h6l-1 5.2 3 3H7l3-3z') + '<path d="M8.5 3.5h7"/><path d="M9.5 3.5l.5 5.2-3 3h10l-3-3 .5-5.2"/><path d="M12 11.7v8.8"/>'),
  play: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8.6 5.2c-.7-.4-1.6.1-1.6.9v11.8c0 .8.9 1.3 1.6.9l9.9-5.9c.7-.4.7-1.4 0-1.8z" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12.6l4 4L18 8"/></svg>',
  tick: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  trash: sv(tone('M6.5 7.5h11l-.9 11.6a1.5 1.5 0 0 1-1.5 1.4H8.9a1.5 1.5 0 0 1-1.5-1.4z') + '<path d="M4.5 7.5h15"/><path d="M9.5 7.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.5"/><path d="M6.5 7.5l.9 11.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-11.6"/><path d="M10.3 11v6M13.7 11v6"/>'),
  refresh: sv('<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4v4.5H15"/>' + dot(12, 12, 1.4)),
  send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5.5M6 11.5l6-6 6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.6" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.6" fill="currentColor"/></svg>',
  image: sv(tone('M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5v.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18.5z') + '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 16l5-5 4 4 2.5-2.5 5.5 5.5"/><circle cx="15.5" cy="8.8" r="1.6"/>'),
  copy: sv(tone('M10.5 8.5h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z') + '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/><path d="M11.8 13h5.4M11.8 16h3.4"/>'),
  tab: sv(tone('M3.5 9.5h17v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z') + '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9.5h17"/>' + dot(6.3, 7.25, .8) + dot(8.6, 7.25, .8) + dot(10.9, 7.25, .8)),
  select: sv(tone('M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z') + '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.3 12.2l2.6 2.6 4.8-5.3" stroke-width="2"/>'),
  crawl: sv(tone('M19 7.6A8 8 0 1 0 19 16.4L12 12z') + '<path d="M19 7.6A8 8 0 1 0 19 16.4L12 12z"/>' + dot(11, 7.8, 1.1) + dot(19.6, 12, 1.1) + dot(23, 12, .9)),
  place: sv(tone('M12 20.5s-6.5-5.5-6.5-11a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11-6.5 11z') + '<path d="M12 20.5s-6.5-5.5-6.5-11a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11-6.5 11z"/><circle cx="12" cy="9.5" r="2.3"/>'),
  history: sv(tone('M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z') + '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4h4"/><path d="M12 8v4.3l2.8 1.7"/>'),
  archive: sv(tone('M5 9h14v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z') + '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v9a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9"/><path d="M10 12.5h4"/>'),
  download: sv(tone('M5 16.5h14v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z') + '<path d="M12 4v10M7.5 10l4.5 4.5 4.5-4.5"/><path d="M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  upload: sv(tone('M5 16.5h14v2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z') + '<path d="M12 14.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M5 15.5v3A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
  bolt: sv(tone('M13.5 3L5.5 13.5H11L10 21l8.5-10.5H13z') + '<path d="M13.5 3L5.5 13.5H11L10 21l8.5-10.5H13z"/>'),
  reset: sv('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5V9H9"/>' + tone('M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z')),
  note: sv(tone('M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z') + '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/>' + dot(12, 8, 1.1)),
  warn: sv(tone('M12 4l9 15.5H3z') + '<path d="M10.3 4.9a2 2 0 0 1 3.4 0l7.2 12.6a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3z"/><path d="M12 9.5v4.5"/>' + dot(12, 17, 1.1)),
  bulb: sv(tone('M12 3.5a6 6 0 0 0-3.5 10.9V17h7v-2.6A6 6 0 0 0 12 3.5z') + '<path d="M9 21h6M9.5 17.5h5"/><path d="M8.5 14.4A6 6 0 1 1 15.5 14.4V17.5h-7z"/><path d="M12 7.5a2 2 0 0 1 2 2"/>'),
  wallet: sv(tone('M4 8h14.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z') + '<path d="M17 8V5.8a1.3 1.3 0 0 0-1.6-1.3L5 7.2A1.5 1.5 0 0 0 4 8.6v8.9A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 8H4"/>' + dot(16.3, 13.5, 1.2)),
};

const urlCache = new Map();
export async function blobURL(key) {
  if (!key) return null;
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await blobs.get(key);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(key, u);
  return u;
}

export function relTime(iso) {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!t) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
export const fmtNum = n => (n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
export const platformName = p => ({ x: 'Twitter', instagram: 'Instagram', web: 'Web' }[p] || p);
export const platformIcon = p => ({ x: ICON.x, instagram: ICON.ig, web: ICON.web }[p] || ICON.web);
export function itemTitle(it) {
  if (!it) return 'Save';
  return it.ai?.title || it.title || (it.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || `${platformName(it.platform)} post by @${it.author?.handle || 'unknown'}`;
}
export const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };

// ---------- basket (chrome.storage so the page buttons and panel stay in sync) ----------
export async function getBasket() { return (await chrome.storage.local.get('basket')).basket || []; }
export async function setBasket(b) { await chrome.storage.local.set({ basket: b }); return b; }
export async function addToBasket(entries) {
  const b = await getBasket();
  let added = 0;
  for (const e of [].concat(entries)) if (!b.some(x => x.id === e.id)) { b.unshift({ kind: 'item', ...e, addedAt: Date.now() }); added++; }
  await setBasket(b);
  return added;
}
export async function removeFromBasket(id) { return setBasket((await getBasket()).filter(x => x.id !== id)); }

// ---------- toasts ----------
export function toast(text, { action, ms = 3600, tone } = {}) {
  let wrap = $('#toasts');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; wrap.className = 'toasts'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast' + (tone ? ' ' + tone : '');
  t.setAttribute('role', 'status');
  t.innerHTML = `<span class="toast-text">${esc(text)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn'; b.textContent = action.label;
    b.onclick = () => { action.run(); t.remove(); };
    t.appendChild(b);
  }
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 350); }, ms);
}

// ---------- lazy images ----------
let io = null;
async function loadImg(img) {
  const key = img.dataset.key;
  const src = (key && await blobURL(key)) || img.dataset.src;
  if (!src) { img.classList.add('broken'); return; }
  img.onload = () => img.classList.add('loaded');
  img.onerror = () => { img.classList.add('broken'); };
  img.src = src;
}
export function observeImages(root) {
  if (!io) io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); loadImg(e.target); }
  }, { rootMargin: '400px' });
  for (const img of root.querySelectorAll('img[data-key]:not([src]), img[data-src]:not([src])')) {
    if (!img.dataset.key && !img.dataset.src) continue;
    io.observe(img);
  }
}

// ---------- media + detail rendering (peek and the pop-out window) ----------
export function mediaSlidesHTML(it) {
  const media = it.media || [];
  if (!media.length) return '';
  const slides = media.map((m, i) => {
    if (m.type === 'video' && !m.url && !m.fullKey) {
      return `<div class="slide" data-i="${i}"><img alt="" data-key="${esc(m.thumbKey || '')}" data-src="${esc(m.poster || '')}"><span class="slide-note">Only the cover frame was captured. Open the original to watch.</span></div>`;
    }
    if (m.type === 'video') {
      return `<div class="slide" data-i="${i}"><video playsinline controls loop preload="metadata" data-key="${esc(m.fullKey || '')}" data-src="${esc(m.url || '')}" data-poster-key="${esc(m.thumbKey || '')}" data-poster="${esc(m.poster || '')}"></video></div>`;
    }
    return `<div class="slide" data-i="${i}"><img alt="" data-key="${esc(m.fullKey || m.thumbKey || '')}" data-src="${esc(m.url || '')}"></div>`;
  }).join('');
  const dots = media.length > 1 ? `<div class="dots">${media.map((_, i) => `<button class="dot${i ? '' : ' on'}" data-go="${i}" aria-label="Media ${i + 1}"></button>`).join('')}</div>` : '';
  return `<div class="carousel">${slides}</div>${dots}`;
}

export async function hydrateMedia(root) {
  for (const img of root.querySelectorAll('.carousel img')) await loadImg(img);
  for (const v of root.querySelectorAll('.carousel video')) {
    const poster = (await blobURL(v.dataset.posterKey)) || v.dataset.poster;
    if (poster) v.poster = poster;
    const src = (await blobURL(v.dataset.key)) || v.dataset.src;
    if (src) v.src = src;
  }
  const car = root.querySelector('.carousel');
  const first = car?.querySelector('.slide:first-child video');
  if (first) { first.muted = true; first.play().catch(() => {}); }
  if (car) {
    car.addEventListener('scroll', () => {
      const i = Math.round(car.scrollLeft / car.clientWidth);
      root.querySelectorAll('.dots .dot').forEach((d, j) => d.classList.toggle('on', i === j));
      car.querySelectorAll('video').forEach((v, j) => { if (+v.closest('.slide').dataset.i !== i) v.pause(); });
    }, { passive: true });
    root.querySelectorAll('.dots .dot').forEach(d => d.addEventListener('click', () => car.scrollTo({ left: car.clientWidth * +d.dataset.go, behavior: 'smooth' })));
  }
}

export function linkify(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${host(u.replace(/&amp;/g, '&'))}${u.length > 40 ? '/…' : ''}</a>`)
    .replace(/\n/g, '<br>');
}

function statusBlock(it, hasKey) {
  if (it.archived) return `<div class="ai-state">Archived to <code>${esc(it.archived.file)}</code>. Import that file in Settings to restore full media.</div>`;
  if (it.status === 'indexed') return '';
  if (it.status === 'indexing') return '<div class="ai-state shimmer">Gemini is reading the images and video…</div>';
  if (it.status === 'error') return `<div class="ai-state err">Indexing failed: ${esc(it.error || 'unknown error')} <button class="link" data-act="reindex">Try again</button></div>`;
  if (!hasKey) return '<div class="ai-state">Collected. Add a Gemini key to index what\'s inside the images and video. <button class="link" data-act="settings">Add key</button></div>';
  return '<div class="ai-state shimmer">Queued for indexing</div>';
}

export function peekBodyHTML(it, { inBasket = false, hasKey = true } = {}) {
  const a = it.ai || {};
  const m = it.metrics || {};
  const metrics = [['likes', 'likes'], ['reposts', 'reposts'], ['comments', 'comments'], ['replies', 'replies'], ['views', 'views']]
    .filter(([k]) => m[k]).map(([k, l]) => `<span><b>${fmtNum(m[k])}</b> ${l}</span>`).join('');
  const segs = [
    ['transcript', 'Transcript', a.transcript],
    ['ocr', 'On-screen text', a.ocr],
    ['moments', 'Moments', (a.moments || []).length ? a.moments.map(x => `<li><time>${esc(x.t)}</time>${esc(x.d)}</li>`).join('') : ''],
    ['visual', 'What\'s shown', a.visual],
  ].filter(s => s[2]);
  const avatar = `<img class="ava" alt="" data-key="${esc(it.author?.avatarKey || '')}" data-src="${esc(it.author?.avatar || '')}">`;
  return `
    <div class="pb">
      <header class="pb-head">
        ${avatar}
        <div class="who"><b>${esc(it.author?.name || it.author?.handle || host(it.url))}</b><span>${it.author?.handle ? '@' + esc(it.author.handle) : esc(host(it.url))}</span></div>
        <span class="plat-badge" data-p="${esc(it.platform)}">${platformIcon(it.platform)}</span>
      </header>
      ${it.text ? `<p class="pb-text">${linkify(it.text)}</p>` : ''}
      ${it.quoted?.text ? `<blockquote class="pb-quote"><b>@${esc(it.quoted.author?.handle || '')}</b> ${linkify(it.quoted.text)}</blockquote>` : ''}
      <div class="pb-meta">${it.createdAt ? `<span>${esc(new Date(it.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))}</span>` : ''}${it.location?.name ? `<span>${ICON.place}${esc(it.location.name)}</span>` : ''}${metrics}</div>
      <div class="pb-actions">
        <button class="btn ${inBasket ? 'on' : ''}" data-act="basket">${inBasket ? ICON.check : ICON.basket}<span>${inBasket ? 'In basket' : 'Add to basket'}</span></button>
        <button class="btn ${it.pinned ? 'on' : ''}" data-act="pin">${ICON.pin}<span>${it.pinned ? 'Pinned' : 'Pin'}</span></button>
        <button class="btn primary" data-act="ask">${ICON.spark}<span>Ask about this</span></button>
      </div>
      ${statusBlock(it, hasKey)}
      ${a.summary ? `
      <section class="ai">
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.summary)}</p>
        ${(a.tags || []).length ? `<div class="chips">${a.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
        ${(a.places || []).length ? `<div class="places">${a.places.map(p => `<a class="place" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.city, p.country].filter(Boolean).join(', '))}" title="${esc(p.note || '')}">${ICON.place}<span>${esc(p.name)}</span>${p.city ? `<small>${esc(p.city)}</small>` : ''}</a>`).join('')}</div>` : ''}
        ${(a.actionable || []).length ? `<ul class="todo">${a.actionable.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${segs.length ? `<div class="seg" role="tablist">${segs.map((s, i) => `<button role="tab" class="${i ? '' : 'on'}" data-seg="${s[0]}">${s[1]}</button>`).join('')}</div>
        <div class="seg-body">${segs.map((s, i) => `<div class="seg-pane" data-pane="${s[0]}" ${i ? 'hidden' : ''}>${s[0] === 'moments' ? `<ul class="moments">${s[2]}</ul>` : `<p>${esc(s[2]).replace(/\n/g, '<br>')}</p>`}</div>`).join('')}</div>` : ''}
      </section>` : ''}
      <footer class="pb-foot">
        <button class="btn ghost" data-act="reindex">${ICON.refresh}<span>Re-index</span></button>
        <button class="btn ghost danger" data-act="delete">${ICON.trash}<span>Delete</span></button>
      </footer>
    </div>`;
}

export function wireSegs(root) {
  root.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('[data-seg]');
    if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    root.querySelectorAll('.seg-pane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.seg; });
  }));
}
