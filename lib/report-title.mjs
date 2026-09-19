// A quarterly/interim report's own commentary often mentions the prior
// *annual* report in passing (e.g. "compared to Annual Report 2023
// results"). Matching that text anywhere in the document mislabels the
// whole filing as that annual report — which then poisons the evidence
// manifest with a document whose title claims "Annual Report 2023" but
// whose actual content is a nine-month interim filing. Real case: three
// different MARI quarterly PDFs all matched "Annual Report 2023" this way.
//
// A genuine annual report states its own title on the cover page, so
// requiring the match to come from early in the extracted text — and the
// filename/URL to not already look quarterly — reliably tells them apart.
export function resolveDocumentTitle(text, filename, url) {
  const looksQuarterly = /q[1-4]|quarter|interim|half.?year/i.test(filename + url);
  const annualMatch = !looksQuarterly && text.slice(0, 4000).match(/Annual Report\s+(20\d{2})/i)?.[0];
  return (annualMatch || filename)
    .replace(/^\d+-/, '')
    .replace(/\.pdf$/i, '')
    .replace(/-/g, ' ');
}
