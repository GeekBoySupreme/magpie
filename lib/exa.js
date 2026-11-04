export async function exaSearch(key, query, numResults = 5, signal) {
  const r = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query, numResults, type: 'auto', contents: { text: { maxCharacters: 1200 } } }),
    signal,
  });
  if (!r.ok) throw new Error(`Exa search failed (${r.status})`);
  const j = await r.json();
  return (j.results || []).map(x => ({ title: x.title || x.url, url: x.url, text: x.text || '', published: x.publishedDate || null }));
}

export async function verifyExa(key) {
  await exaSearch(key, 'test', 1);
  return true;
}
