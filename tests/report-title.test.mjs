import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDocumentTitle } from '../lib/report-title.mjs';

test('takes the annual report title from the cover page of a genuine annual report', () => {
  const text = 'Annual Report 2025\nThe Energy to Evolve\n' + 'filler '.repeat(2000);
  assert.equal(
    resolveDocumentTitle(text, '02-ME-IAR2025-PSX-Website.pdf', 'https://example.com/ME-IAR2025-PSX-Website.pdf'),
    'Annual Report 2025',
  );
});

test('does not mislabel a quarterly report that mentions the prior annual report in its commentary', () => {
  // Real case: three different MARI quarterly PDFs all matched "Annual
  // Report 2023" this way because their own nine-month commentary
  // references it, corrupting the evidence manifest with duplicate,
  // wrongly-labelled documents.
  const text = 'Condensed Interim Financial Statements\n' + 'filler '.repeat(500) +
    ' compared to Annual Report 2023 results, revenue grew ' + 'filler '.repeat(500);
  assert.equal(
    resolveDocumentTitle(text, '06-FR-2025-Q1.pdf', 'https://example.com/FR-2025-Q1.pdf'),
    'FR 2025 Q1',
  );
});

test('resolves a numeric PSX archive filename to a real title when the cover uses "for the year ended" phrasing', () => {
  // Real case (LUCK): PSX's report archive resolves every annual-report
  // link to a bare numeric document id
  // (https://dps.psx.com.pk/download/document/{id}.pdf), so the filename
  // fallback is just digits - and a cover page phrased "Annual Report For
  // the year ended June 30, 2025" (extremely common PSX wording) doesn't
  // match the old "Annual Report" + immediate-year pattern, so every one
  // of these filings fell back to an uninformative numeric title like
  // "67890". The model can never cite that as a source, so every citation
  // of the document then failed the source-manifest check on every row.
  const text = 'LUCKY CEMENT LIMITED\nAnnual Report\nFor the year ended June 30, 2025\n' + 'filler '.repeat(500);
  assert.equal(
    resolveDocumentTitle(text, '01-67890.pdf', 'https://dps.psx.com.pk/download/document/67890.pdf'),
    'Annual Report 2025',
  );
});

test('ignores an "Annual Report YYYY" mention deep in a non-quarterly document, not on its cover page', () => {
  const text = 'filler '.repeat(2000) + ' see Annual Report 2023 for prior-year context ' + 'filler '.repeat(500);
  assert.equal(
    resolveDocumentTitle(text, '05-MARI-Financial-Report-2026-Final-Version.pdf', 'https://example.com/x.pdf'),
    'MARI Financial Report 2026 Final Version',
  );
});
