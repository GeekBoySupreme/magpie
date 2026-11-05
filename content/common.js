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
    // Saved badge: a filled disc with a white rim and a heavy check.
    check: '<span class="mgp-badge" aria-hidden="true"><svg class="mgp-i-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 12.6l3.9 3.9 7.7-8.6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.6" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.6" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8.6 5.2c-.7-.4-1.6.1-1.6.9v11.8c0 .8.9 1.3 1.6.9l9.9-5.9c.7-.4.7-1.4 0-1.8z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4v4.5H15"/></svg>',
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
  M.indexed = new Set();
  const btnById = new Map();
  M.markIndexed = id => {
    M.indexed.add(id);
    const b = btnById.get(id);
    if (b?.isConnected) b.dataset.indexed = '1';
  };
  // Background tells us when Gemini finishes a save, and when data is reset.
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'item:indexed') M.markIndexed(msg.id);
    if (msg?.type === 'saved:reset') {
      M.indexed.clear();
      if (msg.scope !== 'index') M.saved.clear();
      for (const b of btnById.values()) {
        delete b.dataset.indexed;
        if (msg.scope !== 'index') delete b.dataset.state;
      }
    }
  });
  M.makeSaveBtn = ({ id, onSave, className = '' }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mgp-save ' + className;
    b.title = 'Save to Magpie (Shift-click also adds it to your basket)';
    b.setAttribute('aria-label', 'Save to Magpie');
    b.dataset.id = id;
    b.innerHTML = M.icon.mark + M.icon.check;
    if (M.saved.has(id)) b.dataset.state = 'saved';
    if (M.indexed.has(id)) b.dataset.indexed = '1';
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
      for (const sid of r?.indexed || []) M.markIndexed(sid);
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
      <span class="mgp-dock-stats" data-on="0">
        <span class="mgp-n">0</span><span class="mgp-sub">saved</span><span class="mgp-new" data-on="0"></span>
      </span>
      <span class="mgp-dock-ctl" data-on="0">
        <button type="button" class="mgp-dock-icon" data-act="pause" title="Pause"><span class="mgp-ic mgp-ic-pause">${M.icon.pause}</span><span class="mgp-ic mgp-ic-play">${M.icon.play}</span></button>
        <button type="button" class="mgp-dock-icon" data-act="restart" title="Restart: reload the list and keep going">${M.icon.restart}</button>
        <button type="button" class="mgp-dock-icon" data-act="stop" title="Stop">${M.icon.stop}</button>
      </span>
      <span class="mgp-dock-sep" aria-hidden="true"></span>
      <button type="button" class="mgp-dock-icon mgp-dock-panel" data-act="panel" title="Open Magpie">${M.icon.mark}</button>`;
    const $ = s => el.querySelector(s);
    $('.mgp-dock-label').textContent = label;
    document.documentElement.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('mgp-in')));
    let handler = () => {};
    el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) handler(b.dataset.act); });

    // Text swaps slide in rather than snapping.
    const swap = (node, text) => {
      if (node.textContent === text) return;
      node.textContent = text;
      node.classList.remove('mgp-swap'); void node.offsetWidth; node.classList.add('mgp-swap');
    };
    let lastN = 0;
    return {
      el,
      onAction(fn) { handler = fn; },
      set(state, { count = 0, fresh = 0, waiting = false } = {}) {
        el.dataset.state = state;
        el.dataset.waiting = waiting && state === 'running' ? '1' : '0';
        const running = state === 'running' || state === 'paused' || state === 'restarting';
        $('.mgp-dock-stats').dataset.on = running || count ? '1' : '0';
        $('.mgp-dock-ctl').dataset.on = running ? '1' : '0';
        $('.mgp-dock-main').title = state === 'timeout' ? 'Loading timed out. Restart the crawl where it stopped' : '';
        $('[data-act=pause]').title = state === 'paused' ? 'Resume' : 'Pause';
        swap($('.mgp-dock-label'),
          state === 'running' ? (waiting ? 'Loading more' : 'Crawling') : state === 'paused' ? 'Paused' :
          state === 'done' ? 'Crawl again' : state === 'stopped' ? 'Crawl again' :
          state === 'timeout' ? 'Timed out · Restart' : state === 'restarting' ? 'Restarting' : label);
        const n = $('.mgp-n');
        if (count !== lastN) { n.textContent = count; n.classList.remove('mgp-tick'); void n.offsetWidth; n.classList.add('mgp-tick'); lastN = count; }
        const nw = $('.mgp-new');
        nw.dataset.on = fresh ? '1' : '0';
        if (fresh) nw.textContent = `${fresh} new`;
      },
      remove() { el.classList.remove('mgp-in'); setTimeout(() => el.remove(), 450); },
    };
  };

  // Spinners X and Instagram show while the next page of a list loads.
  const LOADER_SEL = '[role="progressbar"], [aria-busy="true"], [data-visualcompletion="loading-state"], svg[aria-label^="Loading"]';
  M.isLoading = () => {
    for (const el of document.querySelectorAll(LOADER_SEL)) {
      if (el.closest('.mgp-dock, .mgp-save, video, [data-testid="videoPlayer"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.top < innerHeight + 1500 && r.bottom > -200) return true;
    }
    return false;
  };
  // "Something went wrong. Try reloading." with a Retry button (X), or
  // Instagram's "Couldn't load" / "Try again" states.
  const RETRY_RE = /^(retry|try again|reload|reload page)$/i;
  M.retryButton = () => [...document.querySelectorAll('main [role="button"], main button, [data-testid="primaryColumn"] [role="button"]')]
    .find(b => RETRY_RE.test((b.innerText || b.textContent || '').trim()) && !b.closest('.mgp-dock') && b.getBoundingClientRect().height);
  M.loadFailed = () => !!M.retryButton() || /couldn['’]t load|something went wrong/i.test(document.querySelector('main')?.innerText?.slice(-600) || '');
  const atBottom = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 24;

  // ---------- sequential crawler ----------
  // collect(): visible entries [{key, el, ...}] ; process(entry) -> item | null
  // Bookmark lists are paginated: when nothing new is on screen the crawler
  // scrolls, then waits while the site is loading and resumes as soon as new
  // posts render. It ends only after the bottom stays quiet through several
  // nudges, or when paused/stopped.
  M.crawler = ({ platform, dock, collect, process, finish, isLoading = M.isLoading }) => {
    const st = { running: false, paused: false, waiting: false, count: 0, fresh: 0, seen: new Set() };
    const progress = state => {
      dock.set(state, st);
      M.send('crawl:progress', { platform, state, count: st.count, fresh: st.fresh, waiting: st.waiting });
    };
    const setWaiting = w => { if (st.waiting !== w) { st.waiting = w; progress(st.paused ? 'paused' : 'running'); } };
    const unseen = () => collect().filter(e => !st.seen.has(e.key));
    const hold = async () => { while (st.paused && st.running) await M.sleep(250); };

    // Resolves 'more' when new posts appear, 'idle' after `quiet` ms with no
    // loader and nothing new, 'stopped' if the crawl ends. Paused time and
    // time spent loading don't count towards `quiet`.
    // 'timeout' when the site shows an error, or its spinner never resolves.
    const LOAD_TIMEOUT = 30000;
    async function waitForMore(quiet) {
      let since = Date.now(), loadingSince = 0;
      while (st.running) {
        if (st.paused) { await hold(); since = Date.now(); loadingSince = 0; continue; }
        if (unseen().length) { setWaiting(false); return 'more'; }
        if (M.loadFailed()) return 'timeout';
        const loading = isLoading();
        setWaiting(true);
        if (loading) { since = Date.now(); loadingSince ||= Date.now(); if (Date.now() - loadingSince > LOAD_TIMEOUT) return 'timeout'; }
        else loadingSince = 0;
        if (Date.now() - since > quiet) return 'idle';
        await M.sleep(220);
      }
      return 'stopped';
    }

    // Nudge the page so it fetches again: press the site's Retry if shown,
    // then scroll up a little and back down to re-trigger the loader.
    async function recover() {
      const rb = M.retryButton();
      if (rb) { rb.click(); await M.sleep(1200); }
      window.scrollBy({ top: -innerHeight * 0.6 });
      await M.sleep(500);
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      await M.sleep(600);
    }

    let loop = null;
    let endState = 'done';
    async function run({ resume = false } = {}) {
      if (st.running) return;
      Object.assign(st, { running: true, paused: false, waiting: false });
      endState = 'done';
      progress('running');
      if (resume) await recover(); else M.nudgeKey();
      let misses = 0;
      while (st.running) {
        await hold();
        if (!st.running) break;
        const batch = unseen();
        if (batch.length) {
          misses = 0;
          setWaiting(false);
          for (const e of batch) {
            await hold();
            if (!st.running) break;
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
            await M.sleep(M.jitter(70, 170));
          }
          continue;
        }
        // Nothing new on screen: scroll on, or poke the infinite loader at the end.
        const y0 = scrollY;
        if (atBottom()) {
          if (misses) { window.scrollBy({ top: -innerHeight * 0.5 }); await M.sleep(300); }
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: innerHeight * 0.8, behavior: 'smooth' });
        }
        await M.sleep(450);
        const stuck = Math.abs(scrollY - y0) < 4;
        const r = await waitForMore(atBottom() || stuck ? 2600 + misses * 1600 : 1200);
        if (r === 'stopped') break;
        if (r === 'timeout') { endState = 'timeout'; break; }
        if (r === 'more') { misses = 0; continue; }
        if (atBottom() || stuck) { misses++; if (misses >= 3) break; }
      }
      st.waiting = false;
      const stopped = !st.running;
      if (!stopped && endState === 'done' && finish) {
        try { await finish(st); } catch (err) { console.debug('[magpie]', err); }
      }
      st.running = false; st.paused = false;
      progress(stopped ? 'stopped' : endState);
    }
    const start = opts => (loop = run(opts));
    return {
      st,
      start,
      // Restart keeps what was already collected and picks up where it left off.
      async restart() {
        if (st.running) { st.running = false; st.paused = false; dock.set('restarting', st); await loop; }
        return start({ resume: true });
      },
      stop() { st.running = false; st.paused = false; },
      pause() { if (!st.running) return; st.paused = !st.paused; progress(st.paused ? 'paused' : 'running'); },
    };
  };

  // Mount/unmount a dock + crawler for a page type; handles panel commands and
  // the "open bookmarks and start crawling" hand-off from the side panel.
  M.setupCrawl = ({ platform, label, isTarget, collect, process, finish, isLoading }) => {
    let dock = null, crawler = null;
    const mount = async () => {
      dock = M.createDock({ platform, label });
      crawler = M.crawler({ platform, dock, collect, process, finish, isLoading });
      dock.set('idle');
      dock.onAction(act => {
        if (act === 'start') crawler.st.running ? crawler.pause() : crawler.st.seen.size ? crawler.restart() : crawler.start();
        if (act === 'restart') crawler.restart();
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
      if (msg.type === 'crawl:restart') crawler.restart();
      reply({ ok: true });
    });
  };
})();
