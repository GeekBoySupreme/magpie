(() => {
  const M = window.Magpie;
  if (!M || M.twitterReady) return;
  M.twitterReady = true;

  const fromBookmarks = new Set();
  const decoder = document.createElement('textarea');
  const decode = s => { decoder.innerHTML = s; return decoder.value; };
  const unwrap = r => (r && r.__typename === 'TweetWithVisibilityResults' ? r.tweet : r);
  const bestMp4 = v => (v?.variants || []).filter(x => x.content_type === 'video/mp4').sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]?.url || null;

  // ---------- normalize GraphQL tweet ----------
  function normTweet(raw, depth = 0) {
    const t = unwrap(raw);
    const L = t?.legacy;
    if (!L?.id_str) return null;
    if (depth === 0 && L.retweeted_status_result?.result) {
      const o = normTweet(L.retweeted_status_result.result, 1);
      if (o) return o;
    }
    const u = t.core?.user_results?.result || {};
    const handle = u.core?.screen_name || u.legacy?.screen_name || '';
    const name = u.core?.name || u.legacy?.name || handle;
    const avatar = (u.avatar?.image_url || u.legacy?.profile_image_url_https || '').replace('_normal', '_bigger');
    const note = t.note_tweet?.note_tweet_results?.result;
    let text = note?.text || L.full_text || '';
    const urls = [...(L.entities?.urls || []), ...(note?.entity_set?.urls || [])];
    const links = [];
    for (const x of urls) if (x.url && x.expanded_url) { text = text.split(x.url).join(x.expanded_url); links.push(x.expanded_url); }
    const mediaRaw = L.extended_entities?.media || L.entities?.media || [];
    for (const m of mediaRaw) if (m.url) text = text.split(m.url).join('');
    text = decode(text).trim();
    const media = mediaRaw.map(m => m.type === 'photo'
      ? { type: 'image', url: `${m.media_url_https}?name=large`, w: m.original_info?.width, h: m.original_info?.height }
      : { type: 'video', url: bestMp4(m.video_info), poster: m.media_url_https, w: m.original_info?.width, h: m.original_info?.height,
          duration: m.video_info?.duration_millis ? m.video_info.duration_millis / 1000 : null, gif: m.type === 'animated_gif' });
    const q = depth < 1 && t.quoted_status_result?.result ? normTweet(t.quoted_status_result.result, depth + 1) : null;
    return {
      id: 'x:' + L.id_str, platform: 'x',
      url: `https://x.com/${handle || 'i'}/status/${L.id_str}`,
      author: { name, handle, avatar },
      text, createdAt: L.created_at ? new Date(L.created_at).toISOString() : null,
      media, links: [...new Set(links)],
      hashtags: (L.entities?.hashtags || []).map(h => h.text),
      metrics: { likes: L.favorite_count, reposts: L.retweet_count, replies: L.reply_count, quotes: L.quote_count, bookmarks: L.bookmark_count, views: t.views?.count ? +t.views.count : undefined },
      quoted: q ? { id: q.id, url: q.url, author: q.author, text: q.text, media: q.media } : null,
      lang: L.lang, via: 'network',
    };
  }

  M.netHandlers.push((url, data) => {
    if (!/graphql|\/i\/api\//.test(url)) return;
    const isBm = /Bookmark/i.test(url);
    M.walk(data, o => {
      if (o.__typename === 'Tweet' && o.legacy?.id_str) {
        const n = normTweet(o);
        if (n) M.net.set(n.id, { ...(M.net.get(n.id) || {}), ...n });
      }
      if (isBm && o.tweet_results?.result) {
        const n = normTweet(o.tweet_results.result);
        if (n) { M.net.set(n.id, { ...(M.net.get(n.id) || {}), ...n }); fromBookmarks.add(n.id); }
      }
    });
  });

  // ---------- DOM extraction (works without the network cache) ----------
  function tweetRef(art) {
    const a = [...art.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector('time'));
    const m = a?.getAttribute('href')?.match(/\/([^/]+)\/status\/(\d+)/);
    return m ? { id: m[2], handle: m[1] } : null;
  }
  function parseMetrics(label) {
    const out = {};
    const re = /([\d,.]+)\s*([KMB]?)\s+(repl|repost|retweet|like|bookmark|view)/gi;
    let m;
    while ((m = re.exec(label))) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      n *= { K: 1e3, M: 1e6, B: 1e9 }[m[2].toUpperCase()] || 1;
      const k = { repl: 'replies', repost: 'reposts', retweet: 'reposts', like: 'likes', bookmark: 'bookmarks', view: 'views' }[m[3].toLowerCase()];
      out[k] = Math.round(n);
    }
    return out;
  }
  function domTweet(art) {
    const ref = tweetRef(art);
    if (!ref) return null;
    const nameBlock = art.querySelector('[data-testid="User-Name"]');
    const name = nameBlock?.querySelector('span')?.innerText?.trim() || ref.handle;
    const images = [...art.querySelectorAll('[data-testid="tweetPhoto"] img')]
      .map(i => ({ type: 'image', url: i.src.replace(/name=\w+/, 'name=large') }));
    const posters = new Set();
    const videos = [...art.querySelectorAll('video')].map(v => {
      const src = v.currentSrc || v.src || v.querySelector('source')?.src || '';
      return { type: 'video', url: /^https?:/.test(src) ? src : null, poster: v.poster || null };
    }).filter(v => (v.poster ? !posters.has(v.poster) && posters.add(v.poster) : true));
    const links = [...art.querySelectorAll('[data-testid="card.wrapper"] a[href], [data-testid="tweetText"] a[href^="http"]')].map(a => a.href);
    return {
      id: 'x:' + ref.id, platform: 'x', url: `https://x.com/${ref.handle}/status/${ref.id}`,
      author: { name, handle: ref.handle, avatar: art.querySelector('[data-testid="Tweet-User-Avatar"] img')?.src || '' },
      text: art.querySelector('[data-testid="tweetText"]')?.innerText || '',
      createdAt: art.querySelector('time')?.getAttribute('datetime') || null,
      media: [...images, ...videos], links: [...new Set(links)],
      metrics: parseMetrics(art.querySelector('[role="group"][aria-label]')?.getAttribute('aria-label') || ''),
      via: 'dom',
    };
  }
  function merged(art, id) {
    const dom = domTweet(art);
    const net = M.net.get(id);
    if (!net) return dom;
    if (!dom) return net;
    return { ...dom, ...net, text: net.text || dom.text, media: net.media?.length ? net.media : dom.media, metrics: { ...dom.metrics, ...Object.fromEntries(Object.entries(net.metrics || {}).filter(([, v]) => v != null)) } };
  }

  // ---------- save button in each tweet's header, just before the "More" ellipsis ----------
  // X re-renders tweet headers freely, so this runs on every mutation and
  // re-inserts the button whenever it has been dropped or moved.
  function ownCaret(art) {
    return [...art.querySelectorAll('[data-testid="caret"]')].find(c => c.closest('article') === art) || null;
  }
  function place(art, btn) {
    const caret = ownCaret(art);
    const anchor = caret?.parentElement;
    if (!anchor?.parentElement) return false;
    if (btn.nextElementSibling !== anchor) anchor.parentElement.insertBefore(btn, anchor);
    return true;
  }
  function decorate() {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const ref = tweetRef(art);
      if (!ref) continue;
      const id = 'x:' + ref.id;
      // Virtualized lists recycle <article>s for other tweets.
      if (art._mgpBtn && art._mgpBtn.dataset.id !== id) { art._mgpBtn.remove(); art._mgpBtn = null; }
      if (!art._mgpBtn) {
        art._mgpBtn = M.makeSaveBtn({
          id, className: 'mgp-tw',
          onSave: async ({ basket }) => { const r = await M.ingest(merged(art, id), { basket }); return r && !r.error; },
        });
        art.dataset.mgp = '1';
        M.queueCheck(id);
      }
      const b = art._mgpBtn;
      if (b.isConnected && b.nextElementSibling === ownCaret(art)?.parentElement) continue;
      place(art, b);
    }
  }
  M.observe(decorate);

  // ---------- bookmarks crawler ----------
  M.setupCrawl({
    platform: 'x',
    label: 'Crawl bookmarks',
    isTarget: () => /^\/i\/bookmarks/.test(location.pathname),
    collect: () => [...document.querySelectorAll('article[data-testid="tweet"]')]
      .map(el => { const r = tweetRef(el); return r && { key: 'x:' + r.id, el }; })
      .filter(Boolean),
    process: async e => merged(e.el, e.key),
    // Bookmarks that loaded over the network but never rendered (virtualized list).
    finish: async st => {
      for (const id of fromBookmarks) {
        if (st.seen.has(id)) continue;
        st.seen.add(id);
        const it = M.net.get(id);
        if (!it) continue;
        const r = await M.ingest(it);
        if (r && !r.error) { st.count++; if (r.isNew) st.fresh++; }
        await M.sleep(40);
      }
    },
  });
})();
