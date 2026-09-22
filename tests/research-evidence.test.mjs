import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEvidence, citedPageText } from '../lib/research-evidence.mjs';

test('retains annual tables, adjacent pages and external evidence without duplicate windows', () => {
  const doc = { title: 'Annual Report 2025', url: 'https://example.com/annual.pdf', text:
    '--- PDF PAGE 1 ---\nContents\n' +
    '--- PDF PAGE 66 ---\nSIX YEAR PERFORMANCE 2024-25 2023-24\nNet Sales 401.18 463.70\n' +
    '--- PDF PAGE 67 ---\nCash Dividend per Share 15.05 10.10\n' +
    '--- PDF PAGE 68 ---\n' + 'production '.repeat(2000) };
  const output = selectEvidence([doc], [{ title: 'Industry review', url: 'https://example.com/review', text: 'Independent industry risks' }]);
  assert.ok(output.includes('Independent industry risks'));
  assert.ok(output.includes('PDF PAGE 66'));
  assert.ok(output.includes('Cash Dividend per Share 15.05'));
  assert.equal(output.match(/Net Sales 401.18/g).length, 1);
});

test('only the primary document\'s multi-year table competes for evidence space', () => {
  const primary = { title: 'Annual Report 2025', url: 'https://example.com/2025.pdf', isPrimary: true, text:
    '--- PDF PAGE 1 ---\nContents\n' +
    '--- PDF PAGE 66 ---\nSIX YEAR PERFORMANCE 2024-25 2023-24\nNet Sales 401.18 463.70\n' };
  const older = { title: 'Annual Report 2021', url: 'https://example.com/2021.pdf', isPrimary: false, text:
    '--- PDF PAGE 1 ---\nContents\n' +
    '--- PDF PAGE 40 ---\nSIX YEAR PERFORMANCE 2020-21 2019-20\nNet Sales 239.10 232.93\n' +
    '--- PDF PAGE 41 ---\nstatement of cash flows details here\n' };
  const output = selectEvidence([primary, older], []);
  assert.ok(output.includes('Net Sales 401.18 463.70'));
  assert.ok(!output.includes('Net Sales 239.10 232.93'));
  assert.ok(output.includes('statement of cash flows'));
});

test('a Ratio Analysis page far from the highlights table still makes the evidence budget', () => {
  // Real case (FFC, 496-page annual report): the audited "Cash Dividend
  // per Share" figure lived on its own Ratio Analysis page, dozens of
  // pages away from the six-year highlights table and any primary
  // statement, surrounded only by generic prose. It scored no "tables" or
  // "statements" bonus and too few generic keyword hits to survive the
  // per-document budget against 100+ higher-priority statement pages in a
  // real, long report, so the model's correct citation was verified
  // against evidence that never actually contained it. This precisely
  // fills the 60,000-char per-document budget with same-priority
  // "statements" pages (zero bytes left over) so only the dividend-row
  // priority bonus can still make room for the Ratio Analysis page.
  const statementPage = (p) => `--- PDF PAGE ${p} ---\nstatement of cash flows `.padEnd(1500, 'x');
  const noise = Array.from({ length: 45 }, (_, p) => statementPage(p + 1)).join('');
  const ratioPage = '--- PDF PAGE 200 ---\nRatio Analysis\nCash dividend per share (interim & proposed final)   Rs   15.49   12.13\n';
  const doc = { title: 'FFC Annual Report 2023', url: 'https://example.com/ffc.pdf', isPrimary: true, text: noise + ratioPage };
  const output = selectEvidence([doc], []);
  assert.ok(output.includes('Cash dividend per share'));
});

test('large annual reports cannot crowd out newer results or web research', () => {
  const docs = Array.from({length:12}, (_,i) => ({ title: `Report ${i}`, url: `https://example.com/${i}`, text:
    Array.from({length:100}, (_,p) => `--- PDF PAGE ${p+1} ---\nstatement of cash flows ${'earnings per share '.repeat(100)}`).join('\n') }));
  const output = selectEvidence(docs, [{ title:'External source', url:'https://example.com/news', text:'LATEST INDUSTRY EVIDENCE' }]);
  assert.ok(output.includes('LATEST INDUSTRY EVIDENCE'));
  assert.ok(output.includes('SOURCE: Report 11'));
  assert.ok(output.length < 850001);
});

test('citedPageText returns only the cited document\'s cited page, ignoring the same number on other pages/documents', () => {
  const docA = { title: 'Annual Report 2025', url: 'https://example.com/a.pdf', text:
    '--- PDF PAGE 1 ---\nContents\n' +
    '--- PDF PAGE 66 ---\nSIX YEAR PERFORMANCE 2024-25 2023-24\nNet Sales 401.18\n' +
    '--- PDF PAGE 67 ---\nUnrelated Net Sales 401.18 elsewhere\n' };
  const docB = { title: 'Annual Report 2024', url: 'https://example.com/b.pdf', text:
    '--- PDF PAGE 66 ---\nNet Sales 401.18 also here but wrong document\n' };
  const evidence = selectEvidence([docA, docB], []);
  const onCitedPage = citedPageText(evidence, 'Annual Report 2025', '66', [docA, docB]);
  assert.ok(onCitedPage.includes('SIX YEAR PERFORMANCE'));
  assert.ok(!onCitedPage.includes('Unrelated Net Sales'));
  const wrongPage = citedPageText(evidence, 'Annual Report 2025', '999', [docA, docB]);
  assert.equal(wrongPage, null);
  const wrongDocument = citedPageText(evidence, 'A document not in the manifest', '66', [docA, docB]);
  assert.equal(wrongDocument, null);
});
