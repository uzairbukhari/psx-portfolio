import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEvidence } from '../lib/research-evidence.mjs';

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

test('large annual reports cannot crowd out newer results or web research', () => {
  const docs = Array.from({length:12}, (_,i) => ({ title: `Report ${i}`, url: `https://example.com/${i}`, text:
    Array.from({length:100}, (_,p) => `--- PDF PAGE ${p+1} ---\nstatement of cash flows ${'earnings per share '.repeat(100)}`).join('\n') }));
  const output = selectEvidence(docs, [{ title:'External source', url:'https://example.com/news', text:'LATEST INDUSTRY EVIDENCE' }]);
  assert.ok(output.includes('LATEST INDUSTRY EVIDENCE'));
  assert.ok(output.includes('SOURCE: Report 11'));
  assert.ok(output.length < 850001);
});
