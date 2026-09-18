import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructPageText } from '../lib/pdf-layout.mjs';

// A minimal stand-in for a pdf.js TextItem: only str/transform[4,5]/width
// are used by reconstructPageText.
const item = (str, x, y, width) => ({ str, transform: [1, 0, 0, 1, x, y], width });

test('keeps a table row label and its numbers on one line, in column order', () => {
  const items = [
    // Row 1 (label + two year columns), items handed back out of order —
    // this is the exact failure mode pdf.js exhibits and a flat join breaks.
    item('463.70', 260, 500, 30),
    item('Net Sales', 50, 500, 60),
    item('401.18', 200, 500, 30),
    // Row 2, a different y — must not merge into row 1.
    item('Profit after tax', 50, 480, 90),
    item('55.20', 200, 480, 25),
  ];
  const text = reconstructPageText(items);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'Net Sales 401.18 463.70');
  assert.equal(lines[1], 'Profit after tax 55.20');
});

test('adjacent glyph runs without a real gap stay joined, not spaced', () => {
  // e.g. a number split into separate runs by kerning: "40" + "1.18"
  const items = [item('40', 200, 500, 12), item('1.18', 212, 500, 20)];
  assert.equal(reconstructPageText(items), '401.18');
});

test('rows are ordered top-to-bottom by y, regardless of input order', () => {
  const items = [
    item('bottom', 0, 100, 20),
    item('top', 0, 300, 20),
    item('middle', 0, 200, 20),
  ];
  assert.equal(reconstructPageText(items), 'top\nmiddle\nbottom');
});

test('empty strings are dropped without producing a blank row', () => {
  const items = [item('', 0, 100, 0), item('value', 10, 100, 20)];
  assert.equal(reconstructPageText(items), 'value');
});
