// Select whole, page-marked passages once, reserving room for every source.
//
// Every annual report a company ever published carries its own multi-year
// "six year performance" / "financial highlights" table, each covering a
// different, overlapping window of fiscal years. The prompt asks the model
// to use only the newest report's table for the five annual rows — but
// each document gets its own independent page budget here, so nothing
// stops 4 older reports' equally-high-priority historical tables from
// riding along too. Feeding the model five overlapping, shifted six-year
// tables at once is a plausible reason it sometimes assigns the same year
// to more than one row. Only the primary (newest) document gets the full
// "tables" bonus; older documents still surface their statement pages for
// verification, just without competing to also supply the summary table.
export function selectEvidence(documents, webSources = []) {
  const sections = [];
  for (const document of documents) {
    const isPrimary = document.isPrimary !== false;
    const pages = document.text.replace(/[ \t]{2,}/g, '\t').split(/(?=--- PDF PAGE \d+ ---)/).filter(Boolean);
    const ranked = pages.map((text, index) => {
      const tables = isPrimary && /(?:six|five)\s+year[s]?\s+performance|financial highlights/i.test(text) && /\d{4}/.test(text);
      const statements = /statement of (?:cash flows|financial position|profit|comprehensive)/i.test(text);
      // The prompt requires citing the exact "Cash Dividend per Share" (or
      // equivalent DPS) row, but that row commonly lives on its own Ratio
      // Analysis page, separate from - and not adjacent to - the six-year
      // highlights table or the primary statements. In a large report
      // (real case: FFC, 496 pages), that page's only other content is
      // generic prose, so it never scored enough on `hits` alone to
      // survive the budget - the model's citation was correct against the
      // real PDF, but the page verification needed was never in the
      // evidence sent to it.
      const dividendRow = /cash dividend per share|dividend per share/i.test(text);
      const hits = text.match(/circular debt|receivables|production|reserves|dividend|earnings per share|related part|auditor|capital adequacy|non.performing|provisions/gi) || [];
      return { text, index, priority: (tables ? 100 : 0) + (statements ? 30 : 0) + (dividendRow ? 30 : 0) + Math.min(hits.length, 20) };
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

// Scopes verification to the exact document and page a financial row cites,
// instead of the whole combined evidence blob. Mirrors the same
// title/url-substring match already used at the synthesize route's manifest
// check, applied here against each "SOURCE:"/"WEB SOURCE:" block this
// module itself produced.
export function citedPageText(evidence, source, page, documents) {
  const normalizedSource = String(source).toLowerCase();
  const cited = documents.find(
    (d) => normalizedSource.includes(d.title.toLowerCase()) || normalizedSource.includes(d.url.toLowerCase()),
  );
  if (!cited) return null;
  const blocks = String(evidence).split(/\n\n(?=SOURCE: |WEB SOURCE: )/);
  const block = blocks.find((b) => {
    const header = b.split('\n', 1)[0];
    return header.includes(cited.title) || header.includes(cited.url);
  });
  if (!block) return null;
  const pageNumber = String(page).match(/\d+/)?.[0];
  if (!pageNumber) return null;
  const pageMarker = new RegExp(`--- PDF PAGE ${pageNumber} ---`);
  const pages = block.split(/(?=--- PDF PAGE \d+ ---)/);
  const found = pages.find((p) => pageMarker.test(p));
  return found ?? null;
}
