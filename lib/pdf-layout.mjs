// Reconstructs reading-order text from pdf.js's positioned text items.
//
// pdf.js hands back text items in whatever internal order it extracted
// them, not reading order — a flat join can interleave columns of a
// financial table (e.g. "Net Sales" from one column landing next to a
// prior year's number from another), which is silent corruption: the AI
// reads a wrong number, and it can still look plausible enough to pass.
// Grouping items into lines by y-position, then ordering each line by
// x-position (what poppler's `pdftotext -layout` did for the old Mac
// helper), keeps a label and its value on the same line in the right
// order — which is what the citation/value-verification checks in
// research-policy.mjs actually key off.
const Y_TOLERANCE = 2;

export function reconstructPageText(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= Y_TOLERANCE);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, end: x + item.width, text: item.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows
    .map((row) => {
      const sorted = [...row.parts].sort((a, b) => a.x - b.x);
      let line = '';
      let cursor = null;
      for (const part of sorted) {
        if (cursor !== null && part.x - cursor > 1 && !/\s$/.test(line)) line += ' ';
        line += part.text;
        cursor = part.end;
      }
      return line;
    })
    .join('\n');
}
