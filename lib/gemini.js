// Gemini REST client (generateContent, SSE streaming, embeddings, Files API).
import { sleep } from './util.js';

const BASE = 'https://generativelanguage.googleapis.com';

export class GeminiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
  get isAuth() { return this.status === 401 || this.status === 403 || /api key/i.test(this.message); }
  get isRate() { return this.status === 429 || this.status >= 500; }
}

async function toErr(r) {
  const t = await r.text().catch(() => '');
  let m = t;
  try { m = JSON.parse(t).error?.message || t; } catch {}
  return new GeminiError(m || `HTTP ${r.status}`, r.status, t);
}

async function req(key, path, body, { signal, method = 'POST' } = {}) {
  const r = await fetch(`${BASE}/v1beta/${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!r.ok) throw await toErr(r);
  return r.json();
}

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (!(e instanceof GeminiError) || !e.isRate || i === tries - 1) throw e;
      await sleep(1500 * 2 ** i + Math.random() * 600);
    }
  }
  throw last;
}

export function genConfig(model, { thinking, schema, temperature } = {}) {
  const c = {};
  if (schema) { c.responseMimeType = 'application/json'; c.responseSchema = schema; }
  if (thinking && /gemini-3/.test(model)) c.thinkingConfig = { thinkingLevel: thinking };
  if (temperature != null) c.temperature = temperature;
  return c;
}

export async function verifyKey(key) {
  const r = await fetch(`${BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!r.ok) throw await toErr(r);
  const j = await r.json();
  return (j.models || []).map(m => m.name.replace(/^models\//, ''));
}

export function textOf(resp) {
  return (resp?.candidates?.[0]?.content?.parts || [])
    .filter(p => typeof p.text === 'string' && !p.thought)
    .map(p => p.text).join('');
}

export async function generate(key, model, { contents, system, schema, tools, thinking, signal }) {
  const body = { contents, generationConfig: genConfig(model, { thinking, schema }) };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools) body.tools = tools;
  return withRetry(() => req(key, `models/${model}:generateContent`, body, { signal }));
}

export async function generateJSON(key, model, opts) {
  const r = await generate(key, model, opts);
  const t = textOf(r).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  if (!t) throw new GeminiError(r?.promptFeedback?.blockReason ? `Blocked: ${r.promptFeedback.blockReason}` : 'Empty response', 500);
  return JSON.parse(t);
}

// Server-sent events stream. Yields raw GenerateContentResponse chunks.
export async function* stream(key, model, body, signal) {
  const r = await fetch(`${BASE}/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw await toErr(r);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { yield JSON.parse(data); } catch {}
    }
  }
}

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => Math.round((x / n) * 1e5) / 1e5);
}

export async function embed(key, model, texts, taskType = 'RETRIEVAL_DOCUMENT', dims = 768) {
  const j = await withRetry(() => req(key, `models/${model}:batchEmbedContents`, {
    requests: texts.map(t => ({
      model: `models/${model}`,
      content: { parts: [{ text: String(t || ' ').slice(0, 8000) }] },
      taskType,
      outputDimensionality: dims,
    })),
  }));
  return (j.embeddings || []).map(e => normalize(e.values || []));
}

// Resumable upload to the Files API (for videos too large to inline).
export async function uploadFile(key, blob, mimeType, displayName = 'magpie') {
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': key,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: String(displayName).slice(0, 120) } }),
  });
  if (!start.ok) throw await toErr(start);
  const url = start.headers.get('x-goog-upload-url');
  if (!url) throw new GeminiError('Upload URL missing from Files API response', 500);

  const up = await fetch(url, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: blob,
  });
  if (!up.ok) throw await toErr(up);
  let { file } = await up.json();
  const t0 = Date.now();
  while (file.state === 'PROCESSING' && Date.now() - t0 < 180000) {
    await sleep(2500);
    file = await req(key, file.name, null, { method: 'GET' });
  }
  if (file.state === 'FAILED') throw new GeminiError('Gemini could not process this video', 500);
  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name, expires: Date.now() + 46 * 3600e3 };
}
