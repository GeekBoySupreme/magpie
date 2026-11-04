(() => {
  const M = window.Magpie;
  if (!M || M.instagramReady) return;
  M.instagramReady = true;

  const CODE_RE = /\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/;
  const urlFor = (code, kind) => `https://www.instagram.com/${/reel|clips/.test(kind || '') ? 'reel' : 'p'}/${code}/`;

  // ---------- normalize API media (v1 + GraphQL shapes) ----------
  function pick(x) {
    const best = x.image_versions2?.candidates?.[0]?.url;
    if (x.video_versions?.length) {
      return { type: 'video', url: x.video_versions[0].url, poster: best, w: x.original_width, h: x.original_height, duration: x.video_duration || null };
    }
    return { type: 'image', url: best, w: x.original_width, h: x.original_height };
  }
  function normIG(m) {
    if (!m?.code) return null;
    const user = m.user || m.owner || {};
    const caption = m.caption?.text || '';
    const media = (m.carousel_media?.length ? m.carousel_media.map(pick) : [pick(m)]).filter(x => x.url || x.poster);
    return {
      id: 'ig:' + m.code, platform: 'instagram', url: urlFor(m.code, m.product_type),
      author: { name: user.full_name || user.username || '', handle: user.username || '', avatar: user.profile_pic_url || '' },
      text: caption, createdAt: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : null,
      media,
      metrics: { likes: m.like_count, comments: m.comment_count, views: m.play_count || m.view_count || m.ig_play_count },
      location: m.location ? { name: m.location.name, city: m.location.city, lat: m.location.lat, lng: m.location.lng } : null,
      hashtags: (caption.match(/#[\p{L}\p{N}_]+/gu) || []).map(s => s.slice(1)),
      audio: m.clips_metadata?.music_info?.music_asset_info?.title || m.clips_metadata?.original_sound_info?.original_audio_title || null,
      kind: m.product_type || null, via: 'network',
    };
  }
  function normLegacy(n) {
    const kids = n.edge_sidecar_to_children?.edges?.map(e => e.node) || [n];
    return {
      id: 'ig:' + n.shortcode, platform: 'instagram', url: urlFor(n.shortcode, n.is_video ? 'clips' : ''),
      author: { name: n.owner?.full_name || n.owner?.username || '', handle: n.owner?.username || '', avatar: n.owner?.profile_pic_url || '' },
      text: n.edge_media_to_caption?.edges?.[0]?.node?.text || '',
      createdAt: n.taken_at_timestamp ? new Date(n.taken_at_timestamp * 1000).toISOString() : null,
      media: kids.map(k => (k.is_video ? { type: 'video', url: k.video_url, poster: k.display_url } : { type: 'image', url: k.display_url })),
      metrics: { likes: n.edge_media_preview_like?.count, comments: n.edge_media_to_comment?.count, views: n.video_view_count },
      location: n.location ? { name: n.location.name } : null, via: 'network',
    };
  }
  const richer = (a, b) => (!a ? b : !b ? a : (b.media?.length || 0) >= (a.media?.length || 0) && (b.text || '').length >= (a.text || '').length ? { ...a, ...b } : { ...b, ...a });

  M.netHandlers.push((url, data) => {
    M.walk(data, o => {
      let n = null;
      if (typeof o.code === 'string' && (o.image_versions2 || o.carousel_media || o.video_versions) && (o.user || o.owner || o.caption !== undefined)) n = normIG(o);
      else if (typeof o.shortcode === 'string' && o.display_url) n = normLegacy(o);
      if (n) M.net.set(n.id, richer(M.net.get(n.id), n));
    });
  });

  // ---------- per-post fetch fallback (same-origin, your own session) ----------
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const codeToId = code => { let id = 0n; for (const c of code.slice(0, 11)) id = id * 64n + BigInt(ALPHA.indexOf(c)); return id.toString(); };
  async function fetchInfo(code) {
    try {
      const r = await fetch(`/api/v1/media/${codeToId(code)}/info/`, {
        credentials: 'include',
        headers: { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!r.ok) return null;
      const j = await r.json();
      const n = normIG(j.items?.[0]);
      if (n) M.net.set(n.id, richer(M.net.get(n.id), n));
      return n;
    } catch { return null; }
  }

  // ---------- DOM fallback ----------
  function domTile(a, code, kind) {
    const img = a.querySelector('img');
    const isVideo = /reel|tv/.test(kind) || !!a.querySelector('svg[aria-label*="Reel" i], svg[aria-label*="Video" i], svg[aria-label*="Clip" i]');
    return {
      id: 'ig:' + code, platform: 'instagram', url: urlFor(code, isVideo ? 'clips' : ''),
      author: {}, text: img?.alt || '',
      media: img ? [isVideo ? { type: 'video', url: null, poster: img.src } : { type: 'image', url: img.src }] : [],
      via: 'dom', partial: true,
    };
  }
  const hasRealMedia = it => it?.media?.length && it.media.some(m => m.url);

  async function resolve(code, fallback) {
    let it = M.net.get('ig:' + code);
    if (!hasRealMedia(it) || !it.text) {
      await M.sleep(M.jitter(450, 1000));
      it = (await fetchInfo(code)) || it;
    }
    return it || fallback();
  }

  // ---------- overlays ----------
  function decorate() {
    // Grid tiles (saved page, profiles, explore)
    for (const a of document.querySelectorAll('a[href]:not([data-mgp])')) {
      const m = a.getAttribute('href').match(CODE_RE);
      if (!m) { a.dataset.mgp = '0'; continue; }
      if (!a.querySelector('img')) continue;
      a.dataset.mgp = '1';
      const [, kind, code] = m;
      const id = 'ig:' + code;
      M.ensureRelative(a);
      a.appendChild(M.makeSaveBtn({
        id, className: 'mgp-ig-tile',
        onSave: async ({ basket }) => { const r = await M.ingest(await resolve(code, () => domTile(a, code, kind)), { basket }); return r && !r.error; },
      }));
      M.queueCheck(id);
    }
    // Feed posts and the post viewer
    for (const art of document.querySelectorAll('article:not([data-mgp-post])')) {
      const link = [...art.querySelectorAll('a[href]')].find(x => x.querySelector('time') && CODE_RE.test(x.getAttribute('href')));
      const m = (link?.getAttribute('href') || (art.closest('[role="dialog"]') ? location.pathname : '')).match(CODE_RE);
      if (!m) continue;
      art.dataset.mgpPost = '1';
      const code = m[2];
      const id = 'ig:' + code;
      M.ensureRelative(art);
      art.appendChild(M.makeSaveBtn({
        id, className: 'mgp-ig-post',
        onSave: async ({ basket }) => {
          const it = await resolve(code, () => ({
            id, platform: 'instagram', url: urlFor(code, m[1]), author: { handle: art.querySelector('header a[href^="/"]')?.textContent || '' },
            text: art.querySelector('h1')?.innerText || '', media: [...art.querySelectorAll('img[srcset], video')].slice(0, 6)
              .map(x => (x.tagName === 'VIDEO' ? { type: 'video', url: /^https?:/.test(x.src) ? x.src : null, poster: x.poster } : { type: 'image', url: x.currentSrc || x.src })),
            via: 'dom', partial: true,
          }));
          const r = await M.ingest(it, { basket });
          return r && !r.error;
        },
      }));
      M.queueCheck(id);
    }
  }
  M.observe(decorate);

  // ---------- saved-page crawler ----------
  const isSaved = () => /^\/[^/]+\/saved(\/|$)/.test(location.pathname);
  M.onUrl(() => { if (isSaved()) M.send('ig:user', { user: location.pathname.split('/')[1] }); });

  M.setupCrawl({
    platform: 'instagram',
    label: 'Crawl saved',
    isTarget: isSaved,
    collect: () => {
      if (/\/saved\/?$/.test(location.pathname)) return []; // collection picker; open a collection first
      return [...document.querySelectorAll('main a[href]')].map(a => {
        const m = a.getAttribute('href').match(CODE_RE);
        return m && a.querySelector('img') ? { key: 'ig:' + m[2], el: a, code: m[2], kind: m[1] } : null;
      }).filter(Boolean);
    },
    process: e => resolve(e.code, () => domTile(e.el, e.code, e.kind)),
  });

  if (/\/saved\/?$/.test(location.pathname)) {
    setTimeout(() => M.toast('Open "All posts" or a collection, then press Crawl.'), 1200);
  }
})();
