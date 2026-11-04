import { blobs } from '../lib/db.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sv = p => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
export const ICON = {
  mark: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.3L5 21V4.5A1.5 1.5 0 0 1 6.5 3z" fill="currentColor"/><circle cx="14.6" cy="8.4" r="1.5" fill="var(--mark-eye, #15121b)"/></svg>',
  spark: sv('<path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18.5 15.5l.6 1.8 1.9.7-1.9.6-.6 1.9-.7-1.9-1.8-.6 1.8-.7z"/>'),
  x: sv('<path d="M5 4.5l14 15M19 4.5L5 19.5"/>'),
  ig: sv('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="17.2" cy="6.8" r=".5" fill="currentColor"/>'),
  web: sv('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5s1.1-5.9 3.5-8.5z"/>'),
  basket: sv('<path d="M4 9.5h16l-1.5 8.8a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z"/><path d="M8.5 9.5L12 4.5l3.5 5"/>'),
  plan: sv('<path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z"/><path d="M9 4.5v13M15 6.5v13"/>'),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/><circle cx="12" cy="12" r="7"/>'),
  close: sv('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  down: sv('<path d="M6 9l6 6 6-6"/>'),
  left: sv('<path d="M15 6l-6 6 6 6"/>'),
  right: sv('<path d="M9 6l6 6-6 6"/>'),
  popout: sv('<rect x="3.5" y="6.5" width="12" height="12" rx="2.5"/><path d="M12.5 3.5h8v8M20.5 3.5l-8.5 8.5"/>'),
  external: sv('<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  pin: sv('<path d="M9 3.5h6l-1 5 3 3H7l3-3z"/><path d="M12 11.5v9"/>'),
  play: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  check: sv('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  trash: sv('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>'),
  refresh: sv('<path d="M19.5 11a7.5 7.5 0 1 0-2.2 5.3M19.5 4.5V11H13"/>'),
  send: sv('<path d="M12 19V5.5M6 11.5l6-6 6 6"/>'),
  stop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/></svg>',
  image: sv('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-5-5-8.5 8.5"/>'),
  copy: sv('<rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>'),
  tab: sv('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/>'),
  select: sv('<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 12l2.5 2.5 4.5-5"/>'),
  crawl: sv('<path d="M19.5 7.5a8.5 8.5 0 1 0 0 9L12 12z"/><circle cx="11.5" cy="7.8" r=".6" fill="currentColor"/>'),
  place: sv('<path d="M12 20.5s-6.5-5.5-6.5-11a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11-6.5 11z"/><circle cx="12" cy="9.5" r="2.2"/>'),
  history: sv('<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6M3.5 4v4.5H8"/><path d="M12 8v4l3 2"/>'),
  archive: sv('<rect x="3.5" y="4.5" width="17" height="4" rx="1.5"/><path d="M5 8.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.5M10 12.5h4"/>'),
  download: sv('<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>'),
  upload: sv('<path d="M12 15.5V4.5M7 9l5-5 5 5M5 19.5h14"/>'),
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
export const platformName = p => ({ x: 'X', instagram: 'Instagram', web: 'Web' }[p] || p);
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
