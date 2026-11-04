import { esc, host } from './shared.js';
import { hashStr } from '../lib/util.js';

function shorten(u) {
  try {
    const x = new URL(u);
    const p = x.pathname.length > 1 ? x.pathname.slice(0, 22) + (x.pathname.length > 22 ? '…' : '') : '';
    return host(u) + p;
  } catch { return u; }
}

function inline(s) {
  const codes = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\[\[item:([^\]\s]+)\]\]/g, (_, id) => `<button type="button" class="cite" data-id="${id}"></button>`);
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, l, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`);
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)"]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener noreferrer">${esc(shorten(u.replace(/&amp;/g, '&')))}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function liHTML(text, checks) {
  const m = text.match(/^\[( |x|X)\]\s+(.*)$/);
  if (!m) return `<li>${inline(text)}</li>`;
  const key = hashStr(m[2]);
  const on = key in checks ? checks[key] : m[1].toLowerCase() === 'x';
  return `<li class="task"><label><input type="checkbox" data-task="${key}" ${on ? 'checked' : ''}><span>${inline(m[2])}</span></label></li>`;
}

function renderList(lis, ordered, checks) {
  const tag = ordered ? 'ol' : 'ul';
  const base = lis[0].ind;
  let html = `<${tag}>`, open = false;
  for (const li of lis) {
    const nested = li.ind - base >= 2;
    if (nested && !open) { html = html.replace(/<\/li>$/, ''); html += '<ul>'; open = true; }
    if (!nested && open) { html += '</ul></li>'; open = false; }
    html += liHTML(li.text, checks);
  }
  if (open) html += '</ul></li>';
  return html + `</${tag}>`;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const BLOCK_START = /^(#{1,6}\s|\s*```|\s*>|\s*([-*+]|\d+[.)])\s+|\s*\|)/;

export function renderMarkdown(src, { checks = {} } = {}) {
  const L = String(src || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (/^\s*```/.test(l)) {
      const buf = []; i++;
      while (i < L.length && !/^\s*```/.test(L[i])) buf.push(L[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < L.length && /^\s*>/.test(L[i])) buf.push(L[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'), { checks })}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(L[i + 1] || '')) {
      const row = s => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2;
      const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) rows.push(row(L[i++]));
      out.push(`<div class="tbl"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (LIST_RE.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const lis = [];
      while (i < L.length && (LIST_RE.test(L[i]) || (lis.length && /^\s{2,}\S/.test(L[i])))) {
        const m = L[i].match(LIST_RE);
        if (m) lis.push({ ind: m[1].length, text: m[3] });
        else lis[lis.length - 1].text += ' ' + L[i].trim();
        i++;
      }
      out.push(renderList(lis, ordered, checks));
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const buf = [l]; i++;
    while (i < L.length && L[i].trim() && !BLOCK_START.test(L[i])) buf.push(L[i++]);
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('');
}

export function taskStats(md, checks = {}) {
  let total = 0, done = 0;
  for (const line of String(md || '').split('\n')) {
    const m = line.match(/^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (!m) continue;
    total++;
    const k = hashStr(m[2]);
    if (k in checks ? checks[k] : m[1].toLowerCase() === 'x') done++;
  }
  return { total, done };
}
