import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FALLBACK_TOKENS as t,
  barOption,
  compact,
  donutOption,
  esc,
  hBarOption,
  rgba,
  timeSeriesOption,
  tipHtml,
} from '../lib/chart-kit.ts';

const money = (n) => `Rs ${n}`;
const run = (fn, params) => fn(params);

test('chart code carries no colour literals: every colour comes from the theme tokens', () => {
  for (const file of [
    '../lib/chart-kit.ts',
    '../app/charts/echart.tsx',
    '../app/charts/day-charts.tsx',
  ]) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${file} has a hex colour`);
    assert.doesNotMatch(src, /rgba?\(\s*\d/, `${file} has an rgb literal`);
  }
});

test('rgba uses the comma syntax the canvas colour parser understands', () => {
  assert.equal(rgba('15 26 46', 0.14), 'rgba(15,26,46,0.14)');
});

test('compact numbers use K/M/B with a real minus sign', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(850), '850');
  assert.equal(compact(1500), '1.5K');
  assert.equal(compact(2_000_000), '2M');
  assert.equal(compact(-3400), '−3.4K');
  assert.equal(compact(1200, true), '+1.2K');
});

test('tooltip text is escaped', () => {
  assert.equal(
    esc('<b>"x" & y</b>'),
    '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;',
  );
  const html = tipHtml(t, '<script>', [{ label: '<i>', value: '1' }]);
  assert.ok(!html.includes('<script>') && !html.includes('<i>'));
});

test('stacked bars: one series per entry, a total row and no zero rows in the tooltip', () => {
  const o = barOption(t, {
    cats: ['Jan', 'Feb'],
    stack: true,
    legend: true,
    series: [
      { name: 'A', data: [10, 0], color: 'red' },
      { name: 'B', data: [5, 20], color: 'blue' },
    ],
    valueFormat: money,
  });
  assert.equal(o.series.length, 2);
  assert.equal(o.series[0].stack, 'all');
  assert.ok(o.legend);
  const html = o.tooltip.formatter([
    {
      seriesName: 'A',
      value: 10,
      color: 'red',
      dataIndex: 0,
      axisValue: 'Jan',
    },
    {
      seriesName: 'B',
      value: 5,
      color: 'blue',
      dataIndex: 0,
      axisValue: 'Jan',
    },
  ]);
  assert.match(html, /Total/);
  assert.match(html, /Rs 15/);
});

test('bySign colours each bar green or red', () => {
  const o = barOption(t, {
    cats: ['a', 'b'],
    series: [{ name: 'x', data: [3, -2], color: 'gray' }],
    bySign: true,
    valueFormat: money,
  });
  assert.equal(o.series[0].data[0].itemStyle.color, t.success);
  assert.equal(o.series[0].data[1].itemStyle.color, t.danger);
});

test('horizontal gain / loss bars: sign colours, labels on the outside, room for the negative label', () => {
  const o = hBarOption(t, {
    name: 'G',
    cats: ['A', 'B'],
    values: [10, -5],
    diverging: true,
    valueFormat: (n) => `${n}%`,
  });
  assert.equal(o.series[0].data[0].itemStyle.color, t.success);
  assert.equal(o.series[0].data[1].itemStyle.color, t.danger);
  assert.equal(o.series[0].data[0].label.position, 'right');
  assert.equal(o.series[0].data[1].label.position, 'left');
  assert.deepEqual(o.xAxis.boundaryGap, [0.14, 0.14]);
  assert.equal(o.yAxis.inverse, true);
});

test('time series: zoom for long series, markers and reference lines, split colouring', () => {
  const data = Array.from({ length: 60 }, (_, i) => ({
    x: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    y: i - 30,
  }));
  const o = timeSeriesOption(t, {
    name: 'Gain',
    data,
    split: true,
    area: true,
    includeZero: true,
    valueFormat: money,
    dateLabel: (x) => String(x),
    refLines: [{ y: 0 }],
    markers: [{ x: '2026-01-05', y: 3, color: 'green', label: 'Bought' }],
  });
  assert.equal(o.dataZoom.length, 2);
  assert.ok(o.series[0].markLine);
  assert.equal(o.series[0].markPoint.data.filter((d) => d.name).length, 1);
  assert.equal(o.series[0].markPoint.data.length, 2, 'the newest point glows');
  assert.equal(o.visualMap[0].pieces[0].color, t.success);
  assert.equal(o.yAxis.scale, false);
  const short = timeSeriesOption(t, {
    name: 'S',
    data: data.slice(0, 5),
    valueFormat: money,
    dateLabel: (x) => String(x),
  });
  assert.equal(short.dataZoom, undefined);
  assert.equal(short.yAxis.scale, true);
});

test('categorical series use a category axis and carry extra lines', () => {
  const o = timeSeriesOption(t, {
    name: 'Value',
    data: [
      { x: 'Jan', y: 1 },
      { x: 'Feb', y: 2 },
    ],
    extra: [{ name: 'Paid in', data: [1, 1], color: 'gray', dashed: true }],
    categorical: true,
    valueFormat: money,
    dateLabel: (x) => String(x),
  });
  assert.equal(o.xAxis.type, 'category');
  assert.deepEqual(o.series[0].data, [1, 2]);
  assert.equal(o.series[1].lineStyle.type, 'dashed');
});

test('timestamps in milliseconds are passed through to the labels', () => {
  const seen = [];
  const o = timeSeriesOption(t, {
    name: 'P',
    data: [
      { x: 1_700_000_000_000, y: 1 },
      { x: 1_700_086_400_000, y: 2 },
    ],
    valueFormat: money,
    dateLabel: (x, _l, tip) => (seen.push([typeof x, tip]), 'd'),
  });
  o.xAxis.axisLabel.formatter(1_700_000_000_000);
  assert.deepEqual(seen[0], ['number', undefined]);
});

test('donut keeps one slice per entry and shows the total in the middle', () => {
  const o = donutOption(t, {
    slices: [
      { name: 'A', value: 60, color: 'red' },
      { name: 'B', value: 40, color: 'blue' },
    ],
    valueFormat: money,
    centerTitle: 'Total',
  });
  assert.equal(o.series[0].data.length, 2);
  assert.match(o.series[0].label.formatter(), /Rs 100/);
  assert.match(
    o.tooltip.formatter({ name: 'A', value: 60, color: 'red', percent: 60 }),
    /60\.0%/,
  );
});

test('time series drops reference lines and markers without a finite value', async () => {
  const { timeSeriesOption } = await import('../lib/chart-kit.ts');
  const t = (await import('../lib/chart-kit.ts')).FALLBACK_TOKENS;
  const o = timeSeriesOption(t, {
    name: 'x',
    data: [
      { x: '2026-01-01', y: 1 },
      { x: '2026-01-02', y: 2 },
    ],
    valueFormat: String,
    axisFormat: String,
    dateLabel: String,
    refLines: [{ y: undefined }, { y: NaN }, { y: 3 }],
    markers: [
      { x: 1, y: NaN, color: 'x', label: 'a' },
      { x: 2, y: 2, color: 'x', label: 'b' },
    ],
  });
  const s = o.series[0];
  assert.equal(s.markLine.data.length, 1);
  assert.equal(s.markPoint.data.filter((d) => d.name).length, 1);
});

// Draws every builder with ECharts itself (server-side SVG): a bad option throws here instead of in a user's browser.
test('every builder draws without throwing, including a series that crosses zero', async () => {
  const echarts = await import('echarts');
  const k = await import('../lib/chart-kit.ts');
  const t = k.FALLBACK_TOKENS;
  const days = (ys) =>
    ys.map((y, i) => ({ x: `2026-01-${String(i + 1).padStart(2, '0')}`, y }));
  const common = { valueFormat: String, axisFormat: String, dateLabel: String };
  const options = {
    split: k.timeSeriesOption(t, {
      name: 'g',
      data: days([-5, -2, 1, 3, 6, 2, -1, 4]),
      area: true,
      split: true,
      includeZero: true,
      refLines: [{ y: 0 }],
      ...common,
    }),
    allPositiveSplit: k.timeSeriesOption(t, {
      name: 'g',
      data: days([1, 2, 3]),
      area: true,
      split: true,
      ...common,
    }),
    markers: k.timeSeriesOption(t, {
      name: 'p',
      data: days([1, 2, 3, 4]),
      area: true,
      markers: [{ x: '2026-01-02', y: 2, color: 'x', label: 'b' }],
      refLines: [{ y: 2 }],
      ...common,
    }),
    categorical: k.timeSeriesOption(t, {
      name: 'c',
      data: days([1]),
      categorical: true,
      step: true,
      ...common,
    }),
    bars: k.barOption(t, {
      cats: ['a', 'b'],
      series: [{ name: 's', data: [1, null], color: t.primary }],
    }),
    hbar: k.hBarOption(t, {
      cats: ['a', 'b'],
      values: [-3, 4],
      diverging: true,
      valueFormat: String,
      name: 'h',
    }),
    donut: k.donutOption(t, {
      slices: [
        { name: 'a', value: 1, color: t.primary },
        { name: 'b', value: 2, color: t.success },
      ],
      valueFormat: String,
    }),
  };
  for (const [name, option] of Object.entries(options)) {
    const chart = echarts.init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 600,
      height: 300,
    });
    assert.doesNotThrow(() => {
      chart.setOption({ ...option, animation: false }, { notMerge: true });
      chart.renderToSVGString();
    }, name);
    chart.dispose();
  }
});
