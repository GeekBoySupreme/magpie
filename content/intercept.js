// Runs in the page's MAIN world at document_start. It watches the JSON the
// site already loads while you scroll (X GraphQL, Instagram feed APIs) and
// forwards it to the isolated content script. It makes no requests of its own.
(() => {
  if (window.__magpieTap) return;
  window.__magpieTap = true;
  const MATCH = /graphql|\/api\/v1\/|\/i\/api\//;
  const post = (url, data) => { try { window.postMessage({ __magpie: 'net', url, data }, location.origin); } catch {} };
  const parse = t => {
    if (!t) return null;
    t = t.replace(/^for \(;;\);/, '').trim();
    if (t[0] !== '{' && t[0] !== '[') return null;
    try { return JSON.parse(t); } catch { return null; }
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = String((args[0] && args[0].url) || args[0] || '');
      if (MATCH.test(url)) {
        res.clone().text().then(t => { const j = parse(t); if (j) post(url, j); }).catch(() => {});
      }
    } catch {}
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__mgpUrl = String(url || '');
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (MATCH.test(this.__mgpUrl || '')) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') { const j = parse(this.responseText); if (j) post(this.__mgpUrl, j); }
          else if (this.responseType === 'json' && this.response) post(this.__mgpUrl, this.response);
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };
})();
