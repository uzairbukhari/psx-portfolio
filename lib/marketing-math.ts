// Pure maths for the public marketing site (calculator and hero charts). The same functions exist in
// public/marketing.js for the browser; tests/marketing.test.mjs checks both give identical output and that the
// projection matches lib/sip-blueprint.ts#projectScenario (the maths behind Future you in the app).
import { projectScenario } from './sip-blueprint.ts';

export type CalcInput = { monthly: number; years: number; annualPct: number; stepUpPct: number };
export type CalcPoint = { year: number; value: number; invested: number };

export const CALC_DEFAULTS: CalcInput = { monthly: 25000, years: 15, annualPct: 12, stepUpPct: 10 };

/** 1234567 -> "1,234,567" (western grouping on purpose: the same text on every device, whatever the locale). */
export function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
export const rs = (n: number): string => `Rs ${group(n)}`;
/** Rupees as people say them: "Rs 95.3 lakh", "Rs 2.05 crore". */
export function rsShort(n: number): string {
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} crore`;
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} lakh`;
  return rs(n);
}
/** Axis labels: "2.0 cr", "83 lakh", "40k". */
export function axisLabel(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)} cr`;
  if (n >= 1e5) return `${Math.round(n / 1e5)} lakh`;
  return `${Math.round(n / 1e3)}k`;
}

export function projectCalc(i: CalcInput): { points: CalcPoint[]; lastMonthly: number } {
  const pts = projectScenario({ monthly: i.monthly, annualPct: i.annualPct, stepUpPct: i.stepUpPct }, {}, i.years);
  return {
    points: pts.slice(1).map((p) => ({ year: p.year, value: p.value, invested: p.invested })),
    lastMonthly: i.monthly * Math.pow(1 + i.stepUpPct / 100, Math.max(0, i.years - 1)),
  };
}

export type CalcView = { invested: string; value: string; last: string; svg: string };

const W = 640;
const H = 280;
const PL = 8;
const PR = 74;
const PB = 26;
const PT = 12;
const f1 = (n: number) => n.toFixed(1);

/** The calculator's numbers and chart (inner SVG markup of a 640x280 viewBox). Colours are literals on purpose: it is SVG text. */
export function calcView(i: CalcInput): CalcView {
  const { points, lastMonthly } = projectCalc(i);
  const end = points[points.length - 1];
  const max = end.value * 1.05;
  const n = points.length;
  const bw = (W - PL - PR) / n;
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const v = (max * g) / 3;
    const gy = y(v);
    grid += `<line x1="${PL}" x2="${W - PR}" y1="${f1(gy)}" y2="${f1(gy)}" stroke="#202B4B" stroke-dasharray="2 4"/><text x="${W - PR + 8}" y="${f1(gy + 4)}" fill="#95A2BF" font-family="monospace" font-size="11">${axisLabel(v)}</text>`;
  }
  let bars = '';
  let line = '';
  let step = '';
  points.forEach((d, k) => {
    const x0 = PL + k * bw + bw * 0.14;
    const w = bw * 0.72;
    bars += `<rect x="${f1(x0)}" y="${f1(y(d.value))}" width="${f1(w)}" height="${f1(H - PB - y(d.value))}" rx="${f1(Math.min(4, w / 3))}" fill="url(#mk-area-b)"/>`;
    step += k ? `H${f1(PL + k * bw)}V${f1(y(d.invested))}` : `M${PL} ${f1(y(d.invested))}`;
    line += `${k ? 'L' : 'M'}${f1(PL + k * bw + bw / 2)} ${f1(y(d.value))}`;
  });
  step += `H${f1(W - PR)}`;
  const lx = PL + (n - 0.5) * bw;
  const ly = y(end.value);
  const marks = [1, Math.ceil(n / 2), n]
    .filter((v, k, a) => a.indexOf(v) === k)
    .map((yy) => `<text x="${f1(PL + (yy - 0.5) * bw)}" y="${H - 6}" text-anchor="middle" fill="#95A2BF" font-family="monospace" font-size="11">Yr ${yy}</text>`)
    .join('');
  const svg =
    grid + bars +
    `<path d="${step}" fill="none" stroke="#95A2BF" stroke-width="1.6" stroke-dasharray="4 4"/>` +
    `<path d="${line}" fill="none" stroke="#2EE6A6" stroke-width="2.6" stroke-linejoin="round"/>` +
    `<circle cx="${f1(lx)}" cy="${f1(ly)}" r="10" fill="#2EE6A6" opacity=".2"/><circle cx="${f1(lx)}" cy="${f1(ly)}" r="4.5" fill="#2EE6A6"/>` +
    marks +
    `<g font-family="sans-serif" font-size="11" fill="#95A2BF"><line x1="${PL + 4}" x2="${PL + 22}" y1="${PT + 8}" y2="${PT + 8}" stroke="#95A2BF" stroke-dasharray="4 4"/><text x="${PL + 28}" y="${PT + 12}">Money you put in</text><line x1="${PL + 140}" x2="${PL + 158}" y1="${PT + 8}" y2="${PT + 8}" stroke="#2EE6A6" stroke-width="2.4"/><text x="${PL + 164}" y="${PT + 12}">Value</text></g>`;
  return { invested: rsShort(end.invested), value: rsShort(end.value), last: rs(lastMonthly), svg };
}

/** Deterministic wobbly series for the decorative charts (sample figures, not data). */
export function sampleSeries(n: number, start: number, end: number, wobble: number, seed: number): number[] {
  let s = seed;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return start + (end - start) * Math.pow(t, 1.35) + (rnd() - 0.5) * wobble * (0.4 + t);
  });
}

export type LineOpts = { width: number; height: number; padR?: number; padB?: number; padT?: number; labels?: boolean; steps?: number[]; color?: string; area?: string; grid?: boolean };

/** Inner SVG markup for a line with an area fill, an optional dashed money-in staircase, grid and a glowing last point. */
export function lineChart(values: number[], o: LineOpts): string {
  const { width: w, height: h } = o;
  const padR = o.padR ?? 44;
  const padB = o.padB ?? 20;
  const padT = o.padT ?? 10;
  const color = o.color ?? '#2EE6A6';
  const all = [...values, ...(o.steps ?? [])];
  const min = Math.min(...all);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (w - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (h - padT - padB);
  let grid = '';
  if (o.grid !== false) {
    for (let g = 0; g < 4; g++) {
      const gy = padT + (g * (h - padT - padB)) / 3;
      const gv = max - (g * (max - min)) / 3;
      grid += `<line x1="0" x2="${w - padR}" y1="${f1(gy)}" y2="${f1(gy)}" stroke="#202B4B" stroke-dasharray="2 4"/>`;
      if (o.labels !== false) grid += `<text x="${w - padR + 8}" y="${f1(gy + 4)}" fill="#95A2BF" font-family="monospace" font-size="10">${(gv / 1e6).toFixed(1)}M</text>`;
    }
  }
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))}`).join('');
  let steps = '';
  if (o.steps) {
    const p = o.steps.map((v, i) => (i ? `H${f1(x(i))}V${f1(y(v))}` : `M0 ${f1(y(v))}`)).join('');
    steps = `<path d="${p}H${w - padR}" fill="none" stroke="#95A2BF" stroke-width="1.4" stroke-dasharray="3 3" opacity=".7"/>`;
  }
  const last = values.length - 1;
  return (
    grid + steps +
    `<path d="${d}L${f1(x(last))} ${h - padB}L0 ${h - padB}Z" fill="url(#${o.area ?? 'mk-area'})"/>` +
    `<path class="ln" d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${f1(x(last))}" cy="${f1(y(values[last]))}" r="9" fill="${color}" opacity=".18"/><circle cx="${f1(x(last))}" cy="${f1(y(values[last]))}" r="4" fill="${color}"/>`
  );
}

/** Plan against a flat-money what-if, 20 years (the "Look ahead" picture). */
export function planChart(): string {
  const a = projectCalc({ monthly: 25000, years: 20, annualPct: 14, stepUpPct: 10 }).points.map((p) => p.value);
  const b = projectCalc({ monthly: 25000, years: 20, annualPct: 14, stepUpPct: 0 }).points.map((p) => p.value);
  const w = 400;
  const h = 180;
  const max = a[a.length - 1] * 1.05;
  const x = (i: number) => 8 + (i * (w - 60)) / 19;
  const y = (v: number) => 10 + (1 - v / max) * (h - 30);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${f1(x(i))} ${f1(y(v))}`).join('');
  return (
    `<path d="${path(a)}L${f1(x(19))} ${h - 20}L8 ${h - 20}Z" fill="url(#mk-area)"/><path d="${path(a)}" fill="none" stroke="#2EE6A6" stroke-width="2.4"/>` +
    `<path d="${path(b)}" fill="none" stroke="#6EA2FF" stroke-width="2" stroke-dasharray="5 4"/>` +
    `<text x="${f1(x(19) + 6)}" y="${f1(y(a[19]) + 4)}" fill="#2EE6A6" font-family="monospace" font-size="11">+10%/yr</text>` +
    `<text x="${f1(x(19) + 6)}" y="${f1(y(b[19]) + 4)}" fill="#6EA2FF" font-family="monospace" font-size="11">flat</text>` +
    `<text x="8" y="${h - 4}" fill="#95A2BF" font-family="monospace" font-size="10">Now</text><text x="${f1(x(19))}" y="${h - 4}" text-anchor="end" fill="#95A2BF" font-family="monospace" font-size="10">20 yrs</text>`
  );
}
