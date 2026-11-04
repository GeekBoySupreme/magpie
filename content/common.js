// Shared runtime for the X and Instagram content scripts.
(() => {
  if (window.Magpie) return;
  const M = (window.Magpie = {});

  M.sleep = ms => new Promise(r => setTimeout(r, ms));
  M.jitter = (a, b) => a + Math.random() * (b - a);
  M.alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  M.send = (type, payload = {}) => new Promise(res => {
    if (!M.alive()) return res(null);
    try { chrome.runtime.sendMessage({ type, ...payload }, r => { void chrome.runtime.lastError; res(r); }); }
    catch { res(null); }
  });

  // Network cache fed by intercept.js (MAIN world).
  M.net = new Map();
  M.netHandlers = [];
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.__magpie !== 'net') return;
    for (const h of M.netHandlers) { try { h(String(e.data.url || ''), e.data.data); } catch (err) { console.debug('[magpie]', err); } }
  });

  M.walk = function walk(o, fn, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, fn, depth + 1); return; }
    fn(o);
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') walk(v, fn, depth + 1); }
  };

  // ---------- icons ----------
  M.icon = {
    mark: '<svg class="mgp-i-mark" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6.5 3h11A1.5 1.5 0 0 1 19 4.5V21l-7-4.3L5 21V4.5A1.5 1.5 0 0 1 6.5 3z" fill="currentColor"/><circle cx="14.6" cy="8.4" r="1.5" fill="#16131c"/></svg>',
    check: '<svg class="mgp-i-check" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>',
  };

  // ---------- toast ----------
  M.toast = (text, { action, ms = 4200 } = {}) => {
    let wrap = document.querySelector('.mgp-toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'mgp-toasts'; document.documentElement.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'mgp-toast';
    t.innerHTML = `<span class="mgp-toast-mark">${M.icon.mark}</span><span class="mgp-toast-text"></span>`;
    t.querySelector('.mgp-toast-text').textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.className = 'mgp-toast-btn'; b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); t.remove(); });
      t.appendChild(b);
    }
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('mgp-in'));
    setTimeout(() => { t.classList.remove('mgp-in'); setTimeout(() => t.remove(), 400); }, ms);
  };

  // ---------- per-item save button ----------
  M.saved = new Set();
  const btnById = new Map();
  M.makeSaveBtn = ({ id, onSave, className = '' }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mgp-save ' + className;
    b.title = 'Save to Magpie (Shift-click also adds it to your basket)';
    b.setAttribute('aria-label', 'Save to Magpie');
    b.dataset.id = id;
    b.innerHTML = M.icon.mark + M.icon.check;
    if (M.saved.has(id)) b.dataset.state = 'saved';
    btnById.set(id, b);
    const swallow = e => { e.stopPropagation(); };
    b.addEventListener('pointerdown', swallow, true);
    b.addEventListener('mousedown', swallow, true);
    b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (b.dataset.state === 'saving') return;
      const prev = b.dataset.state || '';
      b.dataset.state = 'saving';
      try {
        const ok = await onSave({ basket: e.shiftKey });
        if (ok) { M.markSaved(id); if (e.shiftKey) M.toast('Saved and added to basket'); }
        else b.dataset.state = prev;
      } catch {
        b.dataset.state = 'error';
        setTimeout(() => { b.dataset.state = prev; }, 1600);
      }
    }, true);
    return b;
  };
  M.markSaved = id => {
    M.saved.add(id);
    const b = btnById.get(id);
    if (!b || !b.isConnected) return;
    b.dataset.state = 'saved';
    b.classList.remove('mgp-burst'); void b.offsetWidth; b.classList.add('mgp-burst');
  };

  let pendingIds = new Set(), checkTimer = 0;
  M.queueCheck = id => {
    pendingIds.add(id);
    clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      const ids = [...pendingIds]; pendingIds = new Set();
      const r = await M.send('has', { ids });
      for (const sid of r?.saved || []) { M.saved.add(sid); const b = btnById.get(sid); if (b) b.dataset.state = 'saved'; }
    }, 250);
  };

  M.ingest = async (item, { basket } = {}) => {
    const r = await M.send('ingest', { item });
    if (r && !r.error) {
      M.saved.add(item.id);
      if (basket) await M.send('basket:add', { entry: { id: item.id, kind: 'item' } });
    }
    return r;
  };

  M.nudgeKey = async () => {
    const r = await M.send('settings:has-key');
    if (r && !r.hasKey) {
      M.toast('Collecting now. Add a Gemini key in Magpie to index images and video.', {
        action: { label: 'Open Magpie', run: () => M.send('panel:open') }, ms: 7000,
      });
    }
  };

  // ---------- helpers ----------
  M.onUrl = cb => {
    let last = location.href;
    cb(last);
    setInterval(() => { if (location.href !== last) { last = location.href; cb(last); } }, 600);
  };
  M.observe = fn => {
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; try { fn(); } catch (e) { console.debug('[magpie]', e); } });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    fn();
  };
  M.ensureRelative = el => { if (getComputedStyle(el).position === 'static') el.style.position = 'relative'; };

  // ---------- crawl dock (floating, Arc-style pill) ----------
  M.createDock = ({ platform, label }) => {
    const el = document.createElement('div');
    el.className = `mgp-dock mgp-${platform}`;
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Magpie crawler');
    el.innerHTML = `
      <button type="button" class="mgp-dock-main" data-act="start">
        <span class="mgp-chomp" aria-hidden="true"><span class="mgp-jaw mgp-top"></span><span class="mgp-jaw mgp-bot"></span><span class="mgp-dots"></span></span>
        <span class="mgp-dock-label"></span>
      </button>
      <span class="mgp-dock-stats" hidden><span class="mgp-n">0</span><span class="mgp-sub">saved</span><span class="mgp-new" hidden></span></span>
      <button type="button" class="mgp-dock-icon" data-act="pause" hidden title="Pause">${M.icon.pause}</button>
      <button type="button" class="mgp-dock-icon" data-act="stop" hidden title="Stop">${M.icon.stop}</button>
      <button type="button" class="mgp-dock-icon mgp-dock-panel" data-act="panel" title="Open Magpie">${M.icon.mark}</button>`;
    el.querySelector('.mgp-dock-label').textContent = label;
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('mgp-in')));
    let handler = () => {};
    el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) handler(b.dataset.act); });

    const $ = s => el.querySelector(s);
    let lastN = 0;
    return {
      el,
      onAction(fn) { handler = fn; },
      set(state, { count = 0, fresh = 0 } = {}) {
        el.dataset.state = state;
        const running = state === 'running' || state === 'paused';
        $('.mgp-dock-stats').hidden = !(running || count);
        $('[data-act=pause]').hidden = !running;
        $('[data-act=stop]').hidden = !running;
        $('[data-act=pause]').innerHTML = state === 'paused' ? M.icon.play : M.icon.pause;
        $('[data-act=pause]').title = state === 'paused' ? 'Resume' : 'Pause';
        $('.mgp-dock-label').textContent =
          state === 'running' ? 'Crawling' : state === 'paused' ? 'Paused' :
          state === 'done' ? 'All caught up' : state === 'stopped' ? 'Crawl again' : label;
        const n = $('.mgp-n');
        if (count !== lastN) { n.textContent = count; n.classList.remove('mgp-tick'); void n.offsetWidth; n.classList.add('mgp-tick'); lastN = count; }
        const nw = $('.mgp-new');
        nw.hidden = !fresh; nw.textContent = `${fresh} new`;
      },
      remove() { el.classList.remove('mgp-in'); setTimeout(() => el.remove(), 450); },
    };
  };

  // ---------- sequential crawler ----------
  // collect(): visible entries [{key, el, ...}] ; process(entry) -> item | null
  M.crawler = ({ platform, dock, collect, process, finish }) => {
    const st = { running: false, paused: false, count: 0, fresh: 0, seen: new Set() };
    const progress = state => {
      dock.set(state, st);
      M.send('crawl:progress', { platform, state, count: st.count, fresh: st.fresh });
    };
    async function run() {
      if (st.running) return;
      Object.assign(st, { running: true, paused: false });
      progress('running');
      M.nudgeKey();
      let idle = 0;
      while (st.running) {
        if (st.paused) { await M.sleep(300); continue; }
        const batch = collect().filter(e => !st.seen.has(e.key));
        if (batch.length) {
          idle = 0;
          for (const e of batch) {
            if (!st.running) break;
            while (st.paused && st.running) await M.sleep(300);
            st.seen.add(e.key);
            try {
              e.el?.classList.remove('mgp-eaten'); void e.el?.offsetWidth; e.el?.classList.add('mgp-eaten');
              const item = await process(e);
              if (item) {
                const r = await M.ingest(item);
                if (r && !r.error) { st.count++; if (r.isNew) st.fresh++; M.markSaved(item.id); }
              }
            } catch (err) { console.debug('[magpie] crawl item failed', err); }
            progress('running');
            await M.sleep(M.jitter(80, 200));
          }
        } else idle++;
        const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 8;
        if (idle >= (atBottom ? 5 : 12)) break;
        window.scrollBy({ top: innerHeight * 0.75, behavior: 'smooth' });
        await M.sleep(M.jitter(900, 1600));
      }
      const stopped = !st.running;
      if (!stopped && finish) {
        try { await finish(st); } catch (err) { console.debug('[magpie]', err); }
      }
      st.running = false;
      progress(stopped ? 'stopped' : 'done');
    }
    return {
      st,
      start: run,
      stop() { st.running = false; },
      pause() { if (!st.running) return; st.paused = !st.paused; progress(st.paused ? 'paused' : 'running'); },
    };
  };

  // Mount/unmount a dock + crawler for a page type; handles panel commands and
  // the "open bookmarks and start crawling" hand-off from the side panel.
  M.setupCrawl = ({ platform, label, isTarget, collect, process, finish }) => {
    let dock = null, crawler = null;
    const mount = async () => {
      dock = M.createDock({ platform, label });
      crawler = M.crawler({ platform, dock, collect, process, finish });
      dock.set('idle');
      dock.onAction(act => {
        if (act === 'start') crawler.st.running ? crawler.pause() : crawler.start();
        if (act === 'pause') crawler.pause();
        if (act === 'stop') crawler.stop();
        if (act === 'panel') M.send('panel:open');
      });
      const { pendingCrawl } = await chrome.storage.local.get('pendingCrawl');
      if (pendingCrawl?.platform === platform && Date.now() - pendingCrawl.at < 120000) {
        await chrome.storage.local.remove('pendingCrawl');
        setTimeout(() => crawler.start(), 1500);
      }
    };
    M.onUrl(() => {
      if (isTarget()) { if (!dock) mount(); }
      else if (dock && !crawler?.st.running) { dock.remove(); dock = null; crawler = null; }
    });
    chrome.runtime.onMessage.addListener((msg, _s, reply) => {
      if (!msg?.type?.startsWith('crawl:')) return;
      if (!crawler) { reply({ ok: false, reason: 'not-target' }); return; }
      if (msg.type === 'crawl:start') crawler.start();
      if (msg.type === 'crawl:stop') crawler.stop();
      if (msg.type === 'crawl:pause') crawler.pause();
      reply({ ok: true });
    });
  };
})();
