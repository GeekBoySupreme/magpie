import { docText } from './util.js';

const STOP = new Set(('a an the and or of to in on for with is are was be this that it at by from as my me i you your we our ' +
  'what how make give get some any can want need please about into than then them they their there here').split(' '));

export function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^\p{L}\p{N}#@ ]+/gu, ' ')
    .split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}

const tokCache = new Map(); // id -> { stamp, tf, len }
function docTokens(it) {
  const stamp = `${it.updatedAt || 0}:${it.indexedAt || 0}`;
  const hit = tokCache.get(it.id);
  if (hit && hit.stamp === stamp) return hit;
  const tk = tokens(docText(it));
  const tf = new Map();
  for (const t of tk) tf.set(t, (tf.get(t) || 0) + 1);
  const v = { stamp, tf, len: tk.length };
  tokCache.set(it.id, v);
  return v;
}

export function bm25(items, query) {
  const q = [...new Set(tokens(query))];
  const out = new Map();
  if (!q.length || !items.length) return out;
  const docs = items.map(it => ({ id: it.id, ...docTokens(it) }));
  const N = docs.length;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const df = new Map(q.map(t => [t, docs.reduce((n, d) => n + (d.tf.has(t) ? 1 : 0), 0)]));
  for (const d of docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
    }
    if (s > 0) out.set(d.id, s);
  }
  return out;
}

// Hybrid ranking: semantic similarity when we have vectors, keywords always.
export function rank(items, query, qvec, k = 12) {
  const kw = bm25(items, query);
  let maxKw = 0;
  for (const v of kw.values()) maxKw = Math.max(maxKw, v);
  maxKw = maxKw || 1;
  return items.map(it => {
    const b = (kw.get(it.id) || 0) / maxKw;
    const c = qvec && it.embedding ? Math.max(0, cosine(qvec, it.embedding)) : 0;
    const s = qvec ? 0.7 * c + 0.3 * b : b;
    return { it, s };
  }).filter(x => x.s > (qvec ? 0.18 : 0.02))
    .sort((a, b) => b.s - a.s)
    .slice(0, k);
}
