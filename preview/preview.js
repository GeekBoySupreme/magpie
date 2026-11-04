// "Little Arc"-style pop-out: the same save, given the whole window.
import { items } from '../lib/db.js';
import { getSettings } from '../lib/util.js';
import { $, esc, itemTitle, getBasket, addToBasket, removeFromBasket, toast, mediaSlidesHTML, hydrateMedia, peekBodyHTML, wireSegs, observeImages } from '../sidepanel/shared.js';

const id = new URLSearchParams(location.search).get('id');
let item = null, settings = null, basket = [];

async function render(full = true) {
  item = await items.get(id);
  const root = $('#pv');
  if (!item) { root.innerHTML = '<div class="pv-empty">This save no longer exists.</div>'; return; }
  document.title = itemTitle(item);
  document.documentElement.dataset.space = item.platform === 'x' ? 'x' : item.platform === 'instagram' ? 'instagram' : 'all';
  const inBasket = basket.some(b => b.id === id);
  const body = peekBodyHTML(item, { inBasket, hasKey: !!settings.geminiKey });
  if (full) {
    root.innerHTML = `
      <div class="pv-media">${(item.media || []).length ? mediaSlidesHTML(item) : `<div class="pv-empty">${esc(item.text || 'No media')}</div>`}</div>
      <aside class="pv-side"><div class="peek-bar"><b style="padding:0 8px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(itemTitle(item))}</b><a class="btn sm" href="${esc(item.url)}" target="_blank" rel="noopener">Open original</a></div>${body}</aside>`;
    hydrateMedia(root);
  } else {
    root.querySelector('.pb').outerHTML = body;
  }
  observeImages(root);
  wireSegs(root);
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t || !item) return;
  const act = t.dataset.act;
  if (act === 'basket') {
    if (basket.some(b => b.id === id)) await removeFromBasket(id); else await addToBasket({ id, kind: 'item' });
  } else if (act === 'pin') {
    await items.patch(id, x => ({ ...x, pinned: !x.pinned }));
    render(false);
  } else if (act === 'ask') {
    toast('Use the Magpie sidebar to ask. This save is ready to mention with @.');
  } else if (act === 'reindex') {
    await chrome.runtime.sendMessage({ type: 'item:reindex', id });
    toast('Re-indexing with Gemini');
  } else if (act === 'delete') {
    toast('Delete saves from the sidebar');
  }
});

chrome.storage.onChanged.addListener(c => {
  if (c.basket) { basket = c.basket.newValue || []; render(false); }
});
chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'items:changed' && (!msg.ids?.length || msg.ids.includes(id))) render(false);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') window.close(); });

(async () => {
  settings = await getSettings();
  if (settings.theme === 'light' || settings.theme === 'dark') document.documentElement.dataset.theme = settings.theme;
  basket = await getBasket();
  render(true);
})();
