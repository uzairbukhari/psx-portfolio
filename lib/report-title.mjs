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
  // A genuine cover page rarely puts the year directly after "Annual
  // Report" - PSX filings commonly phrase it "Annual Report For the year
  // ended June 30, 2025", with the year 30-80 characters and a line break
  // away. Matching only the immediate-year form left that phrasing falling
  // through to the filename fallback below - which, for a PSX archive link
  // (https://dps.psx.com.pk/download/document/{id}.pdf), is a bare numeric
  // id the model could never cite as its source. Capturing just the year
  // and rebuilding a canonical "Annual Report YYYY" title (rather than
  // keeping the whole matched phrase) keeps the title short and exactly
  // reproducible by the model, regardless of the cover's actual wording.
  const yearMatch = !looksQuarterly && text.slice(0, 4000).match(/Annual Report\b[\s\S]{0,80}?(20\d{2})/i);
  const annualMatch = yearMatch ? `Annual Report ${yearMatch[1]}` : null;
  return (annualMatch || filename)
    .replace(/^\d+-/, '')
    .replace(/\.pdf$/i, '')
    .replace(/-/g, ' ');
}
