// Select whole, page-marked passages once, reserving room for every source.
export function selectEvidence(documents, webSources = []) {
  const sections = [];
  for (const document of documents) {
    const pages = document.text.split(/(?=--- PDF PAGE \d+ ---)/).filter(Boolean);
    const ranked = pages.map((text, index) => {
      const tables = /(?:six|five)\s+year[s]?\s+performance|financial highlights/i.test(text) && /\d{4}/.test(text);
      const statements = /statement of (?:cash flows|financial position|profit|comprehensive)/i.test(text);
      const hits = text.match(/circular debt|receivables|production|reserves|dividend|earnings per share|related part|auditor|capital adequacy|non.performing|provisions/gi) || [];
      return { text, index, priority: (tables ? 100 : 0) + (statements ? 30 : 0) + Math.min(hits.length, 20) };
    }).sort((a,b) => b.priority-a.priority || a.index-b.index);
    const selected = new Set();
    let length = 0;
    for (const page of ranked) {
      if (!page.priority) continue;
      for (const index of [page.index, page.index + 1]) {
        if (!pages[index] || selected.has(index) || length + pages[index].length > 60000) continue;
        selected.add(index); length += pages[index].length;
      }
    }
    sections.push(`SOURCE: ${document.title} | ${document.url}\n${[...selected].sort((a,b)=>a-b).map(i=>pages[i]).join('\n')}`);
  }
  // Web evidence is placed first so it cannot disappear behind annual reports.
  return [
    ...webSources.map(s => `WEB SOURCE: ${s.title} | ${s.url}\n${s.text.slice(0, 18000)}`),
    ...sections,
  ].join('\n\n').slice(0, 850000);
}
