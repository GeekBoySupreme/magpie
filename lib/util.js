export const DEFAULTS = {
  geminiKey: '',
  exaKey: '',
  model: 'gemini-3.1-pro-preview',
  embedModel: 'gemini-embedding-001',
  autoIndex: true,
  storeMedia: true,
  maxVideoMB: 40,
  softMB: 1500,
  hardMB: 3000,
  autoSnapshot: true,
  theme: 'system',
  web: true,
  media: true,
  onboarded: false,
  skills: [],
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const uid = (p = '') => p + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export async function getSettings() {
  const d = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(d.settings || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBlob(b64, type = 'application/octet-stream') {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

// Everything we know about an item, flattened for keyword search and embeddings.
export function docText(item) {
  const a = item.ai || {};
  const places = (a.places || []).map(p => [p.name, p.kind, p.city, p.country, p.note].filter(Boolean).join(', ')).join('; ');
  return [
    a.title,
    item.title,
    item.author?.name && `by ${item.author.name} (@${item.author.handle || ''})`,
    item.text,
    item.quoted?.text && `Quoting: ${item.quoted.text}`,
    a.summary,
    a.category,
    (a.tags || []).join(', '),
    places && `Places: ${places}`,
    item.location?.name && `Location: ${item.location.name}`,
    (a.entities || []).join(', '),
    (a.prices || []).join('; '),
    a.visual,
    a.ocr && `On-screen text: ${a.ocr}`,
    a.transcript && `Transcript: ${a.transcript}`,
    (a.moments || []).map(m => `${m.t} ${m.d}`).join('\n'),
    (a.actionable || []).join('; '),
    (item.hashtags || []).map(h => '#' + h).join(' '),
  ].filter(Boolean).join('\n').slice(0, 9000);
}
