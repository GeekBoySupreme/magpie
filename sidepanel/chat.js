import * as G from '../lib/gemini.js';
import { rank } from '../lib/search.js';
import { exaSearch } from '../lib/exa.js';
import { blobToBase64 } from '../lib/util.js';
import { blobs } from '../lib/db.js';
import { itemTitle } from './shared.js';

export const BUILTIN_SKILLS = [
  { cmd: 'plan', name: 'Plan a trip', prompt: 'Build a detailed day-by-day itinerary. Open with a short summary and a > [!TIP] callout with the single best insider tip. Then one "### Day N: Theme" section per day, grouping stops by neighborhood to minimize transit. Inside each day, use timeline bullets that start with a bold time ("- **09:00** …") giving the stop in bold, why it is worth it, the cost, and how to get to the next stop. Pull every relevant place, food and tip from the saves, and fill gaps from the web. Add a "### Budget" table (item, per person, notes) and a > [!WARNING] callout for closures, seasonality or booking deadlines. End with a "### Get ready" task list with booking links.' },
  { cmd: 'summarize', name: 'Summarize', prompt: 'Summarize the referenced saves into the key takeaways, grouped by theme, citing each save.' },
  { cmd: 'compare', name: 'Compare', prompt: 'Compare the options found in the saves in a Markdown table (price, location, highlights, drawbacks), then give a clear recommendation.' },
  { cmd: 'links', name: 'Collect links', prompt: 'Collect every actionable link needed: official sites, booking and reservation pages, tickets, maps, and shops. Group them and present each as a task list item.' },
  { cmd: 'recipe', name: 'Recipes', prompt: 'Turn the food saves into usable recipes with ingredients and steps. Use what is shown or said in the videos; note anything you inferred.' },
  { cmd: 'shop', name: 'Shopping list', prompt: 'Extract every product mentioned or shown, with price if known and where to buy it. Use links from the web results.' },
  { cmd: 'digest', name: 'Weekly digest', prompt: 'Write a digest of the most interesting saves, grouped by theme, with one line each on why it matters and what to do next.' },
];

export async function readTab(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.tabId ?? tab.id },
      func: () => {
        const root = document.querySelector('article, main') || document.body;
        return { title: document.title, url: location.href, text: (root.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 12000) };
      },
    });
    return r?.result || { title: tab.title, url: tab.url, text: '' };
  } catch (e) {
    return { title: tab.title || tab.label, url: tab.url, text: '', error: String(e?.message || e) };
  }
}

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

function itemBlock(it) {
  const a = it.ai || {};
  const lines = [
    `### [[item:${it.id}]] ${it.platform} post by @${it.author?.handle || it.author?.name || '?'}${it.createdAt ? `, ${it.createdAt.slice(0, 10)}` : ''}`,
    `URL: ${it.url}`,
    a.title && `Title: ${a.title}`,
    a.summary && `Summary: ${a.summary}`,
    it.text && `Text: ${clip(it.text, 1500)}`,
    it.quoted?.text && `Quoted post: ${clip(it.quoted.text, 400)}`,
    it.location?.name && `Tagged location: ${it.location.name}`,
    (a.places || []).length && `Places: ${a.places.map(p => [p.name, p.kind, p.city, p.country].filter(Boolean).join(', ') + (p.note ? ` (${p.note})` : '')).join('; ')}`,
    (a.prices || []).length && `Prices: ${a.prices.join('; ')}`,
    (a.entities || []).length && `Mentions: ${a.entities.join(', ')}`,
    a.transcript && `Video transcript: ${clip(a.transcript, 2200)}`,
    (a.moments || []).length && `Video moments: ${a.moments.map(m => `${m.t} ${m.d}`).join(' | ')}`,
    a.ocr && `On-screen text: ${clip(a.ocr, 900)}`,
    a.visual && `Visual: ${clip(a.visual, 600)}`,
    [...(it.links || []), ...(a.links || [])].length && `Links in post: ${[...new Set([...(it.links || []), ...(a.links || [])])].slice(0, 10).join(' ')}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function systemPrompt(skill) {
  return `You are Magpie, a research assistant in the user's browser sidebar. The user saves posts from X and Instagram (and web pages). Each save has been indexed: its text, the text inside its images, transcripts of its videos, and descriptions of what they show.

How to answer:
- Ground the answer in the SAVED ITEMS first. Right after any sentence that uses a save, cite it inline as [[item:ID]] with the exact ID given. Cite several when relevant. Never invent IDs.
- Attached images and videos belong to the item named in the text just before them. Look at them closely.
- Use the WEB RESULTS and Google Search to fill gaps, check facts that change (hours, prices, seasons, closures), and find official or booking links. Only use URLs that appear in the provided context or in search grounding. Never make up a URL.
- If the user states preferences (budget, pace, diet, dates, who's travelling, style), follow them and say briefly how the answer reflects them.
- Be specific: names, neighborhoods, timings, prices with currency, how to get between places.
- Your answer is rendered as rich text in a narrow browser sidebar. Make it scannable and well structured, using this Markdown:
  - Open with a one or two sentence summary. No title line, no H1 or H2.
  - Use ### headings for sections. Use **bold** for the names of places, dishes, products and key numbers.
  - Prefer short bullet points to long paragraphs. Keep paragraphs to two or three sentences.
  - Itineraries and schedules: one "### Day N: Theme" section per day (exactly that pattern). Inside, timeline bullets that start with a bold time or part of day, then the detail: "- **09:00** Coffee at **Café Name** in Alfama [[item:ID]]. €4. Walk 8 min to the next stop." or "- **Evening** …".
  - Compare options, prices and budgets in a Markdown table with 3 to 5 short columns.
  - Callouts for asides, as a blockquote whose first line is the marker and an optional short title: "> [!TIP] Go early" then the text on the next "> " line. Markers: [!TIP] insider tips, [!NOTE] useful context, [!WARNING] closures, seasonality, scams or booking deadlines, [!BUDGET] cost summaries. Use at most three per answer.
  - ==Highlight== at most one or two must-not-miss facts.
  - Plans end with a "### Get ready" section as a task list ("- [ ] Book … [site](url)") covering bookings, tickets, transport, documents and packing.
  - No emoji, no HTML, no horizontal rules between every section.
- If the saves don't cover something, say so in a sentence and fill it from the web.
Today's date is ${new Date().toDateString()}.${skill ? `\n\nActive skill, "${skill.name}": ${skill.prompt}` : ''}`;
}

async function planQueries(settings, question, ctxItems, skill, signal) {
  const r = await G.generateJSON(settings.geminiKey, settings.model, {
    contents: [{ role: 'user', parts: [{ text:
      `Write up to 4 short web search queries (under 10 words each) that would find official sites, booking or ticket pages, and current practical info needed for this request. Prefer specific names that appear in the saved items.
Request: ${question}
${skill ? `Task: ${skill.name}\n` : ''}Saved items: ${ctxItems.slice(0, 10).map(i => itemTitle(i) + ((i.ai?.places || []).length ? ` (${i.ai.places.map(p => p.name).slice(0, 4).join(', ')})` : '')).join('; ')}` }] }],
    schema: { type: 'OBJECT', properties: { queries: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['queries'] },
    thinking: 'low', signal,
  });
  return (r.queries || []).filter(Boolean).slice(0, 4);
}

async function mediaParts(ctxItems, maxImages = 10) {
  const parts = [];
  let imgs = 0;
  for (const it of ctxItems.slice(0, 6)) {
    let perItem = 0;
    for (const m of it.media || []) {
      if (m.type === 'video' && m.fileUri && m.fileExp > Date.now() + 600e3) {
        parts.push({ text: `Video for [[item:${it.id}]]:` }, { fileData: { mimeType: m.fileMime || 'video/mp4', fileUri: m.fileUri } });
        continue;
      }
      if (imgs >= maxImages || perItem >= 2) continue;
      const key = m.thumbKey;
      if (!key) continue;
      const b = await blobs.get(key);
      if (!b) continue;
      parts.push({ text: `${m.type === 'video' ? 'Video frame' : 'Image'} for [[item:${it.id}]]:` }, { inlineData: { mimeType: b.type || 'image/webp', data: await blobToBase64(b) } });
      imgs++; perItem++;
    }
  }
  return parts;
}

/**
 * question, history[{role,text}], pinned[item], platforms[], tabDocs[{title,url,text}],
 * skill, web, media, settings, allItems, onStatus, onDelta, signal
 */
export async function ask(o) {
  const { question, history = [], pinned = [], platforms, tabDocs = [], skill, web, media, settings, allItems, onStatus, onDelta, signal } = o;
  const key = settings.geminiKey;

  onStatus?.('Searching your saves');
  const pool = allItems.filter(i => !platforms || platforms.includes(i.platform));
  let qvec = null;
  if (pool.some(i => i.embedding)) {
    try { [qvec] = await G.embed(key, settings.embedModel, [question + (skill ? ` (${skill.name})` : '')], 'RETRIEVAL_QUERY'); } catch {}
  }
  const ranked = rank(pool, `${question} ${skill?.name || ''}`, qvec, pinned.length ? 8 : 16).map(x => x.it);
  const seen = new Set();
  const ctxItems = [...pinned, ...ranked].filter(i => i && !seen.has(i.id) && seen.add(i.id)).slice(0, 22);

  let webResults = [];
  if (web && settings.exaKey) {
    onStatus?.('Researching the web');
    try {
      const qs = await planQueries(settings, question, ctxItems, skill, signal);
      const settled = await Promise.allSettled(qs.map(q => exaSearch(settings.exaKey, q, 4, signal)));
      const urls = new Set();
      webResults = settled.flatMap(s => (s.status === 'fulfilled' ? s.value : [])).filter(r => r.url && !urls.has(r.url) && urls.add(r.url)).slice(0, 14);
    } catch (e) { if (e?.name === 'AbortError') throw e; }
  }

  onStatus?.(`Reading ${ctxItems.length} saves${tabDocs.length ? ` and ${tabDocs.length} tab${tabDocs.length > 1 ? 's' : ''}` : ''}`);
  const ctx = [
    ctxItems.length ? `SAVED ITEMS\n\n${ctxItems.map(itemBlock).join('\n\n')}` : 'SAVED ITEMS: none matched this request.',
    tabDocs.length ? `OPEN TABS\n\n${tabDocs.map(t => `### ${t.title}\nURL: ${t.url}\n${clip(t.text, 7000)}`).join('\n\n')}` : '',
    webResults.length ? `WEB RESULTS\n\n${webResults.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${clip(r.text, 900)}`).join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  const parts = [{ text: ctx }];
  if (media) parts.push(...await mediaParts(ctxItems));
  parts.push({ text: `REQUEST: ${question}` });

  const contents = [
    ...history.slice(-8).filter(m => m.text).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
    { role: 'user', parts },
  ];
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt(skill) }] },
    generationConfig: G.genConfig(settings.model, { thinking: 'high' }),
  };
  if (web) body.tools = [{ google_search: {} }];

  onStatus?.('Thinking');
  let text = '', grounding = null;
  for await (const chunk of G.stream(key, settings.model, body, signal)) {
    const c = chunk.candidates?.[0];
    const t = (c?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
    if (t) { text += t; onDelta?.(text); }
    if (c?.groundingMetadata) grounding = c.groundingMetadata;
  }
  if (!text) throw new Error('Gemini returned an empty answer. Try rephrasing or turning off Media.');

  const sources = [];
  const su = new Set();
  for (const r of webResults) if (!su.has(r.url)) { su.add(r.url); sources.push({ title: r.title, url: r.url, via: 'Exa' }); }
  for (const g of grounding?.groundingChunks || []) {
    const w = g.web;
    if (w?.uri && !su.has(w.uri)) { su.add(w.uri); sources.push({ title: w.title || w.uri, url: w.uri, via: 'Google' }); }
  }
  const cited = [...text.matchAll(/\[\[item:([^\]\s]+)\]\]/g)].map(m => m[1]);
  return { text, sources, itemIds: [...new Set([...cited, ...ctxItems.slice(0, 8).map(i => i.id)])] };
}
