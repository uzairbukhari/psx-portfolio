// Pure option builders for the ECharts-based charts. Colours come in as resolved theme tokens (a canvas cannot read CSS
// variables), so no hex literals live here and every theme is covered. Type-only import: this file never loads ECharts.
import type { EChartsOption } from 'echarts';

export type AssetKey = 'stocks' | 'gold' | 'silver' | 'plans' | 'funds' | 'currency';

export type ChartTokens = {
  text: string;
  muted: string;
  line: string;
  popover: string;
  border: string;
  primary: string;
  primary3: string;
  success: string;
  danger: string;
  warn: string;
  other: string;
  neutral: string;
  /** Categorical palette (--cat-1..7). */
  cat: string[];
  /** One fixed colour per asset class (--asset-*), the same in every chart and legend. */
  asset: Record<AssetKey, string>;
  /** "r g b" triplets, for translucent fills. */
  rgb: { primary: string; success: string; danger: string; line: string };
  font: string;
  /** Figures (axis labels, tooltips) use the mono face. */
  mono: string;
};

/** Comma syntax on purpose: the canvas colour parser does not read `rgb(r g b / a)`. */
export const rgba = (triplet: string, alpha: number) =>
  `rgba(${triplet.trim().split(/\s+/).join(',')},${alpha})`;

/** Used on the server and before the first read; the real values come from the page's CSS variables. */
export const FALLBACK_TOKENS: ChartTokens = {
  text: 'currentColor',
  muted: 'gray',
  line: rgba('128 128 128', 0.2),
  popover: 'white',
  border: rgba('128 128 128', 0.3),
  primary: 'royalblue',
  primary3: 'skyblue',
  success: 'seagreen',
  danger: 'firebrick',
  warn: 'goldenrod',
  other: 'gray',
  neutral: 'gray',
  cat: [
    'royalblue',
    'orangered',
    'seagreen',
    'goldenrod',
    'hotpink',
    'green',
    'slateblue',
  ],
  asset: {
    stocks: 'royalblue',
    gold: 'goldenrod',
    silver: 'slategray',
    plans: 'teal',
    funds: 'slateblue',
    currency: 'steelblue',
  },
  rgb: {
    primary: '37 99 235',
    success: '10 115 80',
    danger: '180 35 24',
    line: '15 26 46',
  },
  font: 'system-ui, sans-serif',
  mono: 'ui-monospace, Menlo, monospace',
};

export function readTokens(
  root: HTMLElement = document.documentElement,
): ChartTokens {
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const f = FALLBACK_TOKENS;
  return {
    text: v('--foreground', f.text),
    muted: v('--muted-foreground', f.muted),
    line: rgba(v('--ch-line', f.rgb.line), 0.14),
    popover: v('--popover', f.popover),
    border: v('--border', f.border),
    primary: v('--primary', f.primary),
    primary3: v('--primary-3', f.primary3),
    success: v('--chart-up', v('--success', f.success)),
    danger: v('--chart-down', v('--danger', f.danger)),
    warn: v('--warn-strong', f.warn),
    other: v('--chart-other', f.other),
    neutral: v('--chart-neutral', f.neutral),
    cat: [1, 2, 3, 4, 5, 6, 7].map((n, i) => v(`--cat-${n}`, f.cat[i])),
    asset: {
      stocks: v('--asset-stocks', f.asset.stocks),
      gold: v('--asset-gold', f.asset.gold),
      silver: v('--asset-silver', f.asset.silver),
      plans: v('--asset-plans', f.asset.plans),
      funds: v('--asset-funds', f.asset.funds),
      currency: v('--asset-fx', f.asset.currency),
    },
    rgb: {
      primary: v('--ch-primary', f.rgb.primary),
      success: v('--ch-chart-up', v('--ch-success', f.rgb.success)),
      danger: v('--ch-chart-down', v('--ch-danger', f.rgb.danger)),
      line: v('--ch-line', f.rgb.line),
    },
    font: getComputedStyle(document.body).fontFamily || f.font,
    mono:
      v('--font-geist-mono', '') && `${v('--font-geist-mono', '')}, ${f.mono}`
        ? `${v('--font-geist-mono', '')}, ${f.mono}`
        : f.mono,
  };
}

export const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

/** 1.2K / 3.4M, with a real minus sign. */
export function compact(v: number, signed = false): string {
  const a = Math.abs(v);
  const body =
    a >= 1e9
      ? `${trim(a / 1e9)}B`
      : a >= 1e6
        ? `${trim(a / 1e6)}M`
        : a >= 1e3
          ? `${trim(a / 1e3)}K`
          : `${Math.round(a * 100) / 100}`;
  return v < 0 ? `−${body}` : signed && v > 0 ? `+${body}` : body;
}
const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, '');

export type TipRow = {
  label: string;
  value: string;
  color?: string;
  tone?: 'pos' | 'neg' | 'muted';
};

/** Tooltip body: a title line and one row per value. Everything is escaped. */
export function tipHtml(t: ChartTokens, title: string, rows: TipRow[]): string {
  const tone = (r: TipRow) =>
    r.tone === 'pos'
      ? t.success
      : r.tone === 'neg'
        ? t.danger
        : r.tone === 'muted'
          ? t.muted
          : t.text;
  const body = rows
    .map(
      (r) =>
        `<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;margin-top:3px">` +
        `<span style="display:flex;align-items:center;gap:6px;color:${t.muted}">` +
        (r.color
          ? `<i style="width:8px;height:8px;border-radius:2px;background:${esc(r.color)};display:inline-block"></i>`
          : '') +
        `${esc(r.label)}</span><b style="font-variant-numeric:tabular-nums;color:${tone(r)}">${esc(r.value)}</b></div>`,
    )
    .join('');
  return `<div style="min-width:150px"><div style="font-weight:600">${esc(title)}</div>${body}</div>`;
}

function base(
  t: ChartTokens,
  o: { top?: number; right?: number; bottom?: number; left?: number } = {},
): EChartsOption {
  return {
    animationDuration: 350,
    animationDurationUpdate: 200,
    textStyle: { fontFamily: t.font, color: t.muted },
    aria: { enabled: true, decal: { show: false } },
    grid: {
      top: o.top ?? 14,
      right: o.right ?? 14,
      bottom: o.bottom ?? 4,
      left: o.left ?? 4,
      containLabel: true,
    },
    tooltip: {
      confine: true,
      backgroundColor: t.popover,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12, fontFamily: t.font },
      extraCssText:
        'border-radius:10px;box-shadow:0 12px 32px -12px rgb(var(--ch-shadow) / .35);',
      axisPointer: {
        lineStyle: { color: t.muted, type: 'dashed' },
        crossStyle: { color: t.muted },
      },
    },
  };
}

const axisCommon = (t: ChartTokens) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: {
    color: t.muted,
    fontSize: 11,
    hideOverlap: true,
    fontFamily: t.mono,
  },
});

const valueAxis = (
  t: ChartTokens,
  format: (n: number) => string,
  extra: Record<string, unknown> = {},
) => ({
  type: 'value' as const,
  ...axisCommon(t),
  position: 'right' as const,
  axisLabel: {
    color: t.muted,
    fontSize: 11,
    fontFamily: t.mono,
    formatter: (n: number) => format(n),
    hideOverlap: true,
  },
  splitLine: { lineStyle: { color: t.line, type: [2, 4] as number[] } },
  ...extra,
});

// ───────────────────────── time series ─────────────────────────

/** An ISO date ("2026-10-13") or a timestamp in milliseconds. */
export type TimeX = string | number;
const ms = (x: TimeX) =>
  typeof x === 'number' ? x : Date.parse(`${x}T12:00:00Z`);

export type TimeSeriesCfg = {
  data: { x: TimeX; y: number }[];
  color?: string;
  /** Fill under the line. */
  area?: boolean;
  /** Colour the part above zero green and below zero red. */
  split?: boolean;
  valueFormat: (n: number) => string;
  axisFormat?: (n: number) => string;
  /** `tip` is true for the tooltip title (usually the full date) and false for axis ticks. */
  dateLabel: (x: TimeX, long: boolean, tip?: boolean) => string;
  /** Extra tooltip rows for the hovered index. */
  rows?: (i: number) => TipRow[];
  /** The series name in the tooltip. */
  name: string;
  /** More lines on the same axes (for example an average cost). `null` leaves a gap. */
  extra?: {
    name: string;
    data: (number | null)[];
    color: string;
    dashed?: boolean;
    step?: boolean;
  }[];
  markers?: {
    x: TimeX;
    y: number;
    color: string;
    label: string;
    up?: boolean;
  }[];
  refLines?: { y: number; label?: string; color?: string }[];
  zoom?: boolean;
  step?: boolean;
  /** Include zero in the axis (gain / loss). */
  includeZero?: boolean;
  /** Evenly spaced labelled points instead of a time scale (a handful of payments). */
  categorical?: boolean;
  /** Whole numbers only on the value axis (counts). */
  integer?: boolean;
};

export function timeSeriesOption(
  t: ChartTokens,
  c: TimeSeriesCfg,
): EChartsOption {
  // The green/red split only works when the data crosses zero: ECharts builds no gradient stops
  // otherwise and throws, so a one-sided series is simply drawn in its own colour.
  const crosses = c.data.some((d) => d.y > 0) && c.data.some((d) => d.y <= 0);
  const oneSided = c.split && !crosses && c.data.length > 0;
  const main = oneSided
    ? c.data[0].y > 0
      ? t.success
      : t.danger
    : (c.color ?? t.primary);
  const o = base(t, { top: 16, right: 12 });
  const long =
    c.data.length > 1 &&
    Math.abs(ms(c.data[c.data.length - 1].x) - ms(c.data[0].x)) >
      300 * 86_400_000;
  const numeric = typeof c.data[0]?.x === 'number';
  // ECharts throws while rendering a marker whose coordinate is missing or NaN, so only finite ones go in.
  const refLines = (c.refLines ?? []).filter((l) => Number.isFinite(l.y));
  const markers = (c.markers ?? []).filter(
    (m) => Number.isFinite(ms(m.x)) && Number.isFinite(m.y),
  );
  const last = c.data[c.data.length - 1];
  const glow =
    !c.categorical && c.data.length > 1 && last && Number.isFinite(ms(last.x)) && Number.isFinite(last.y)
      ? last
      : null;
  const areaRgb =
    main === t.success
      ? t.rgb.success
      : main === t.danger
        ? t.rgb.danger
        : t.rgb.primary;
  const markLine = refLines.length
    ? {
        silent: true,
        symbol: 'none',
        animation: false,
        lineStyle: { color: t.muted, type: 'dashed' as const, width: 1 },
        label: {
          color: t.muted,
          fontSize: 10,
          position: 'insideEndTop' as const,
        },
        data: refLines.map((l) => ({
          yAxis: l.y,
          lineStyle: {
            color: l.color ?? t.muted,
            type: 'dashed' as const,
            width: 1,
          },
          label: { formatter: l.label ?? '', color: l.color ?? t.muted },
        })),
      }
    : undefined;
  const mainSeries = {
    name: c.name,
    type: 'line' as const,
    data: c.categorical
      ? c.data.map((d) => d.y)
      : c.data.map((d) => [d.x, d.y]),
    showSymbol: !!c.categorical,
    symbolSize: 7,
    smooth: false,
    step: c.step ? ('end' as const) : false,
    sampling: 'lttb' as const,
    lineStyle: { width: 2.4, color: main, cap: 'round' as const, join: 'round' as const },
    itemStyle: { color: main },
    emphasis: { focus: 'none' as const },
    areaStyle: c.area
      ? c.split && crosses
        ? { opacity: 0.16, origin: 0 as unknown as 'auto' }
        : {
            color: {
              type: 'linear' as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                {
                  offset: 0,
                  color: rgba(areaRgb, 0.28),
                },
                {
                  offset: 1,
                  color: rgba(areaRgb, 0.02),
                },
              ],
            },
          }
      : undefined,
    markLine,
    markPoint: markers.length || glow
      ? {
          symbol: 'circle',
          symbolSize: 9,
          animation: false,
          data: [
            ...markers.map((m) => ({
              coord: [m.x, m.y],
              name: m.label,
              itemStyle: {
                color: m.color,
                borderColor: t.popover,
                borderWidth: 1.5,
              },
            })),
            // The newest point glows, like the Android charts.
            ...(glow
              ? [
                  {
                    coord: [glow.x, glow.y],
                    name: '',
                    symbolSize: 10,
                    itemStyle: {
                      color: main,
                      borderColor: t.popover,
                      borderWidth: 2,
                      shadowBlur: 14,
                      shadowColor: main,
                    },
                  },
                ]
              : []),
          ],
          label: { show: false },
          tooltip: {
            formatter: (p: { name?: string }) =>
              p.name ? `<div style="font-weight:600">${esc(p.name)}</div>` : '',
          },
        }
      : undefined,
  };
  const extra = (c.extra ?? []).map((e) => ({
    name: e.name,
    type: 'line' as const,
    data: e.data.map((y, i) => [c.data[i]?.x, y]),
    showSymbol: false,
    step: e.step ? ('end' as const) : false,
    connectNulls: false,
    lineStyle: {
      width: 1.5,
      color: e.color,
      type: e.dashed ? ('dashed' as const) : ('solid' as const),
    },
    itemStyle: { color: e.color },
  }));
  const zoom =
    c.zoom !== false && c.data.length > 30
      ? [
          {
            type: 'inside' as const,
            filterMode: 'none' as const,
            zoomLock: false,
          },
        ]
      : undefined;
  return {
    ...o,
    grid: { ...(o.grid as object), bottom: 4 },
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: {
        type: c.categorical ? 'line' : 'cross',
        label: { show: false },
        lineStyle: { color: t.muted, type: 'dashed' },
        crossStyle: { color: t.muted },
      },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          dataIndex: number;
          axisValue?: string;
          value?: unknown[];
        }[];
        const i = ps[0]?.dataIndex ?? 0;
        const d = c.data[i];
        if (!d) return '';
        const rows: TipRow[] = [
          {
            label: c.name,
            value: c.valueFormat(d.y),
            color: main,
            tone: c.split ? (d.y >= 0 ? 'pos' : 'neg') : undefined,
          },
          ...(c.rows?.(i) ?? []),
        ];
        return tipHtml(t, c.dateLabel(d.x, true, true), rows);
      },
    },
    xAxis: c.categorical
      ? {
          type: 'category',
          data: c.data.map((d) => c.dateLabel(d.x, false)),
          boundaryGap: true,
          ...axisCommon(t),
        }
      : {
          type: 'time',
          ...axisCommon(t),
          axisLabel: {
            color: t.muted,
            fontSize: 11,
            hideOverlap: true,
            formatter: (v: number) =>
              c.dateLabel(
                numeric ? v : new Date(v).toISOString().slice(0, 10),
                long,
              ),
          },
          splitLine: { show: false },
        },
    yAxis: valueAxis(t, c.axisFormat ?? compact, {
      scale: !c.includeZero,
      ...(c.integer ? { minInterval: 1 } : {}),
    }),
    dataZoom: zoom,
    visualMap:
      c.split && crosses
        ? [
            {
              show: false,
              type: 'piecewise',
              dimension: 1,
              seriesIndex: 0,
              // Finite bounds on purpose: open-ended pieces (gt/lte) leave ECharts with no gradient
              // stops and it throws while drawing the line.
              pieces: [
                { min: 0, max: 1e15, color: t.success },
                { min: -1e15, max: 0, color: t.danger },
              ],
              outOfRange: { color: t.danger },
            },
          ]
        : undefined,
    series: [mainSeries, ...extra],
  } as EChartsOption;
}

// ───────────────────────── vertical bars (optionally stacked) ─────────────────────────

export type BarSeries = {
  name: string;
  data: (number | null)[];
  color: string;
};
export type BarCfg = {
  cats: string[];
  series: BarSeries[];
  stack?: boolean;
  valueFormat: (n: number) => string;
  axisFormat?: (n: number) => string;
  /** Pretty label for a category in the tooltip title. */
  catTitle?: (cat: string) => string;
  /** A unit shown on the y axis. */
  yName?: string;
  selectable?: boolean;
  /** Text added after a series name in the legend (for example its share). */
  legendSuffix?: Record<string, string>;
  /** Longer names for the tooltip (the series name stays short for the legend). */
  labels?: Record<string, string>;
  /** Colour each bar by its sign instead of the series colour. */
  bySign?: boolean;
  legend?: boolean;
  /** Whole numbers only on the value axis (counts). */
  integer?: boolean;
};

export function barOption(t: ChartTokens, c: BarCfg): EChartsOption {
  const o = base(t, {
    top: c.legend ? 14 + Math.ceil(c.series.length / 3) * 22 : 14,
  });
  const multi = c.series.length > 1;
  return {
    ...o,
    legend: c.legend
      ? {
          top: 0,
          type: 'plain',
          icon: 'roundRect',
          itemWidth: 10,
          itemHeight: 10,
          textStyle: { color: t.muted, fontSize: 11 },
          pageTextStyle: { color: t.muted },
          formatter: c.legendSuffix
            ? (name: string) =>
                `${name}${c.legendSuffix?.[name] ? ` ${c.legendSuffix[name]}` : ''}`
            : undefined,
        }
      : undefined,
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
        shadowStyle: { color: rgba(t.rgb.line, 0.08) },
      },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          seriesName: string;
          value: number | null;
          color: string;
          dataIndex: number;
          axisValue: string;
        }[];
        if (!ps.length) return '';
        const cat = ps[0].axisValue;
        const rows: TipRow[] = ps
          .filter(
            (p) => p.value !== null && p.value !== undefined && p.value !== 0,
          )
          .sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0))
          .map((p) => ({
            label: c.labels?.[p.seriesName] ?? p.seriesName,
            value: c.valueFormat(p.value ?? 0),
            color: typeof p.color === 'string' ? p.color : undefined,
            tone: c.bySign ? ((p.value ?? 0) >= 0 ? 'pos' : 'neg') : undefined,
          }));
        if (c.stack && multi)
          rows.push({
            label: 'Total',
            value: c.valueFormat(ps.reduce((a, p) => a + (p.value ?? 0), 0)),
          });
        if (!rows.length)
          rows.push({ label: 'None', value: c.valueFormat(0), tone: 'muted' });
        return tipHtml(t, c.catTitle ? c.catTitle(cat) : cat, rows);
      },
    },
    xAxis: {
      type: 'category',
      data: c.cats,
      ...axisCommon(t),
      axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, fontFamily: t.mono },
    },
    yAxis: valueAxis(t, c.axisFormat ?? compact, {
      name: c.yName,
      nameTextStyle: { color: t.muted, fontSize: 11, align: 'left' },
      ...(c.integer ? { minInterval: 1 } : {}),
    }),
    series: c.series.map((s) => ({
      name: s.name,
      type: 'bar' as const,
      stack: c.stack ? 'all' : undefined,
      data: s.data.map((v) =>
        c.bySign && v !== null
          ? { value: v, itemStyle: { color: v >= 0 ? t.success : t.danger } }
          : v,
      ),
      barMaxWidth: 26,
      cursor: c.selectable ? 'pointer' : 'default',
      itemStyle: { color: s.color, borderRadius: c.stack ? 0 : [6, 6, 3, 3] },
      emphasis: { focus: 'series' as const, itemStyle: { opacity: 0.85 } },
    })),
  } as EChartsOption;
}

// ───────────────────────── horizontal bars ─────────────────────────

export type HBarCfg = {
  cats: string[];
  values: (number | null)[];
  valueFormat: (n: number) => string;
  /** Shorter form for the label at the end of each bar. */
  labelFormat?: (n: number) => string;
  axisFormat?: (n: number) => string;
  /** Colour by sign (gain / loss); otherwise the primary colour. */
  diverging?: boolean;
  color?: string;
  catTitle?: (cat: string, i: number) => string;
  /** Extra tooltip rows per bar. */
  rows?: (i: number) => TipRow[];
  selectable?: boolean;
  name: string;
  /** Axis maximum (for example 100 for a percent). */
  max?: number;
};

export function hBarOption(t: ChartTokens, c: HBarCfg): EChartsOption {
  const o = base(t, { top: 6, right: 56 });
  return {
    ...o,
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
        shadowStyle: { color: rgba(t.rgb.line, 0.08) },
      },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          dataIndex: number;
          value: number | null;
          axisValue: string;
        }[];
        const p = ps[0];
        if (!p) return '';
        const v = p.value ?? 0;
        const rows: TipRow[] = [
          {
            label: c.name,
            value: c.valueFormat(v),
            tone: c.diverging ? (v >= 0 ? 'pos' : 'neg') : undefined,
          },
          ...(c.rows?.(p.dataIndex) ?? []),
        ];
        return tipHtml(
          t,
          c.catTitle ? c.catTitle(p.axisValue, p.dataIndex) : p.axisValue,
          rows,
        );
      },
    },
    xAxis: valueAxis(t, c.axisFormat ?? compact, {
      max: c.max,
      ...(c.diverging ? { boundaryGap: [0.14, 0.14] } : {}),
    }),
    yAxis: {
      type: 'category',
      data: c.cats,
      inverse: true,
      ...axisCommon(t),
      axisLabel: { color: t.text, fontSize: 11, fontWeight: 600 },
    },
    series: [
      {
        name: c.name,
        type: 'bar',
        data: c.values.map((v) =>
          v !== null && c.diverging
            ? {
                value: v,
                itemStyle: { color: v >= 0 ? t.success : t.danger },
                label: { position: v >= 0 ? 'right' : 'left' },
              }
            : v,
        ),
        barMaxWidth: 14,
        cursor: c.selectable ? 'pointer' : 'default',
        itemStyle: { color: c.color ?? t.primary, borderRadius: 7 },
        label: {
          show: true,
          position: 'right',
          color: t.muted,
          fontSize: 11,
          formatter: (p: { value: unknown }) =>
            typeof p.value === 'number'
              ? (c.labelFormat ?? c.valueFormat)(p.value)
              : '',
        },
        emphasis: { itemStyle: { opacity: 0.85 } },
      },
    ],
  } as EChartsOption;
}

// ───────────────────────── donut ─────────────────────────

export type DonutCfg = {
  slices: { name: string; value: number; color: string }[];
  valueFormat: (n: number) => string;
  centerFormat?: (n: number) => string;
  centerTitle?: string;
  selectable?: boolean;
};

export function donutOption(t: ChartTokens, c: DonutCfg): EChartsOption {
  const total = c.slices.reduce((a, s) => a + s.value, 0);
  const centerText = () => {
    const v = (c.centerFormat ?? c.valueFormat)(total);
    return c.centerTitle ? `{k|${c.centerTitle}}\n{v|${v}}` : `{v|${v}}`;
  };
  return {
    animationDuration: 350,
    textStyle: { fontFamily: t.font, color: t.muted },
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      confine: true,
      trigger: 'item',
      backgroundColor: t.popover,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12, fontFamily: t.font },
      extraCssText:
        'border-radius:10px;box-shadow:0 12px 32px -12px rgb(var(--ch-shadow) / .35);',
      formatter: (p: {
        name: string;
        value: number;
        color: string;
        percent: number;
      }) =>
        tipHtml(t, p.name, [
          { label: 'Value', value: c.valueFormat(p.value), color: p.color },
          { label: 'Share', value: `${p.percent.toFixed(1)}%` },
        ]),
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '86%'],
        center: ['50%', '50%'],
        padAngle: 3,
        avoidLabelOverlap: true,
        cursor: c.selectable ? 'pointer' : 'default',
        itemStyle: { borderRadius: 8, borderColor: t.popover, borderWidth: 1 },
        label: {
          show: true,
          position: 'center',
          formatter: centerText,
          rich: {
            k: { color: t.muted, fontSize: 11, lineHeight: 16 },
            v: { color: t.text, fontSize: 13, fontWeight: 700, fontFamily: t.mono },
          },
        },
        emphasis: {
          scaleSize: 4,
          label: {
            show: true,
            formatter: centerText,
            rich: {
              k: { color: t.muted, fontSize: 11, lineHeight: 16 },
              v: { color: t.text, fontSize: 13, fontWeight: 700, fontFamily: t.mono },
            },
          },
        },
        data: c.slices.map((s) => ({
          name: s.name,
          value: s.value,
          itemStyle: { color: s.color },
        })),
      },
    ],
  } as EChartsOption;
}

/** The colour of an asset class, the same everywhere. */
export const classColor = (t: ChartTokens, k: AssetKey) => t.asset[k];

// ───────────────────────── sparkline ─────────────────────────

/** A bare line for hero slabs and tiles: no axes, no tooltip, the newest point glows. */
export function sparklineOption(
  t: ChartTokens,
  c: { values: number[]; color?: string; area?: boolean },
): EChartsOption {
  const color = c.color ?? t.primary;
  const rgbOf =
    color === t.success ? t.rgb.success : color === t.danger ? t.rgb.danger : t.rgb.primary;
  const n = c.values.length;
  return {
    animationDuration: 500,
    aria: { enabled: true, decal: { show: false } },
    grid: { top: 4, right: 6, bottom: 4, left: 6 },
    xAxis: { type: 'category', show: false, data: c.values.map((_, i) => i), boundaryGap: false },
    yAxis: { type: 'value', show: false, scale: true },
    series: [
      {
        type: 'line',
        data: c.values,
        showSymbol: false,
        silent: true,
        smooth: 0.2,
        lineStyle: { width: 2, color, cap: 'round', join: 'round' },
        areaStyle:
          c.area === false
            ? undefined
            : {
                color: {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: rgba(rgbOf, 0.3) },
                    { offset: 1, color: rgba(rgbOf, 0) },
                  ],
                },
              },
        markPoint:
          n > 1
            ? {
                symbol: 'circle',
                symbolSize: 8,
                animation: false,
                label: { show: false },
                data: [
                  {
                    coord: [n - 1, c.values[n - 1]],
                    itemStyle: { color, shadowBlur: 12, shadowColor: color },
                  },
                ],
              }
            : undefined,
      },
    ],
  } as EChartsOption;
}

// ───────────────────────── stacked area ─────────────────────────

export type StackedAreaCfg = {
  /** ISO dates, one per point. */
  dates: string[];
  series: { name: string; data: number[]; color: string }[];
  valueFormat: (n: number) => string;
  dateLabel: (x: string, long: boolean) => string;
  /** A dashed reference (for example today's value). */
  refLine?: { y: number; label: string; color?: string };
};

export function stackedAreaOption(t: ChartTokens, c: StackedAreaCfg): EChartsOption {
  const o = base(t, { top: 28, right: 12 });
  const refLine =
    c.refLine && Number.isFinite(c.refLine.y)
      ? {
          silent: true,
          symbol: 'none',
          animation: false,
          lineStyle: { color: c.refLine.color ?? t.muted, type: 'dashed' as const, width: 1 },
          label: {
            formatter: c.refLine.label,
            color: c.refLine.color ?? t.muted,
            fontSize: 10,
            position: 'insideStartTop' as const,
          },
          data: [{ yAxis: c.refLine.y }],
        }
      : undefined;
  return {
    ...o,
    legend: {
      top: 0,
      // One line on narrow cards; a wrapped legend would sit over the reference line's label.
      type: 'scroll',
      pageTextStyle: { color: t.muted },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: t.muted, fontSize: 11 },
    },
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.muted, type: 'dashed' } },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          seriesName: string;
          value: number;
          color: string;
          dataIndex: number;
        }[];
        if (!ps.length) return '';
        const rows: TipRow[] = ps
          .filter((p) => p.value)
          .sort((a, b) => b.value - a.value)
          .map((p) => ({ label: p.seriesName, value: c.valueFormat(p.value), color: p.color }));
        rows.push({ label: 'Total', value: c.valueFormat(ps.reduce((a, p) => a + p.value, 0)) });
        return tipHtml(t, c.dateLabel(c.dates[ps[0].dataIndex] ?? '', true), rows);
      },
    },
    xAxis: {
      type: 'category',
      data: c.dates,
      boundaryGap: false,
      ...axisCommon(t),
      axisLabel: {
        color: t.muted,
        fontSize: 11,
        hideOverlap: true,
        fontFamily: t.mono,
        formatter: (v: string) => c.dateLabel(v, false),
      },
    },
    // Keep the reference line on the chart when it sits above the stack (worth more than was paid in).
    yAxis: {
      ...valueAxis(t, compact, { scale: false }),
      ...(refLine ? { max: (v: { max: number }) => Math.max(v.max, c.refLine!.y * 1.05) } : {}),
    },
    series: c.series.map((s, i) => ({
      name: s.name,
      type: 'line' as const,
      stack: 'all',
      data: s.data,
      showSymbol: false,
      smooth: false,
      sampling: 'lttb' as const,
      lineStyle: { width: 1.5, color: s.color },
      itemStyle: { color: s.color },
      areaStyle: { color: s.color, opacity: 0.72 },
      emphasis: { focus: 'series' as const },
      markLine: i === c.series.length - 1 ? refLine : undefined,
    })),
  } as EChartsOption;
}

// ───────────────────────── combo: bars plus a cumulative line ─────────────────────────

export type ComboCfg = {
  cats: string[];
  bars: { name: string; data: number[]; color: string };
  line: { name: string; data: number[]; color: string };
  valueFormat: (n: number) => string;
  catTitle?: (cat: string) => string;
};

export function comboOption(t: ChartTokens, c: ComboCfg): EChartsOption {
  const o = base(t, { top: 28, right: 12 });
  return {
    ...o,
    legend: {
      top: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: t.muted, fontSize: 11 },
    },
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: rgba(t.rgb.line, 0.08) } },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as {
          seriesName: string;
          value: number;
          color: string;
          axisValue: string;
        }[];
        if (!ps.length) return '';
        return tipHtml(
          t,
          c.catTitle ? c.catTitle(ps[0].axisValue) : ps[0].axisValue,
          ps.map((p) => ({
            label: p.seriesName,
            value: c.valueFormat(p.value ?? 0),
            color: typeof p.color === 'string' ? p.color : undefined,
          })),
        );
      },
    },
    xAxis: { type: 'category', data: c.cats, ...axisCommon(t) },
    yAxis: [
      valueAxis(t, compact, { position: 'left' as const }),
      valueAxis(t, compact, { splitLine: { show: false } }),
    ],
    series: [
      {
        name: c.bars.name,
        type: 'bar',
        data: c.bars.data,
        barMaxWidth: 24,
        itemStyle: { color: c.bars.color, borderRadius: [6, 6, 3, 3] },
      },
      {
        name: c.line.name,
        type: 'line',
        yAxisIndex: 1,
        data: c.line.data,
        showSymbol: false,
        smooth: false,
        lineStyle: { width: 2.2, color: c.line.color, cap: 'round' },
        itemStyle: { color: c.line.color },
      },
    ],
  } as EChartsOption;
}

// ───────────────────────── waterfall ─────────────────────────

export type WaterfallStep = {
  label: string;
  /** A delta for a step; the running total for a `total` bar. */
  value: number;
  kind: 'start' | 'step' | 'total';
};
export type WaterfallCfg = {
  steps: WaterfallStep[];
  valueFormat: (n: number) => string;
};

/** Bars from a running base: the base series is transparent, so gains float up and losses float down. */
export function waterfallOption(t: ChartTokens, c: WaterfallCfg): EChartsOption {
  const o = base(t, { top: 14, right: 12 });
  let running = 0;
  const baseData: number[] = [];
  const up: (number | null)[] = [];
  const down: (number | null)[] = [];
  const total: (number | null)[] = [];
  const startEnd: { from: number; to: number }[] = [];
  for (const s of c.steps) {
    if (s.kind === 'step') {
      const from = running;
      running += s.value;
      startEnd.push({ from, to: running });
      baseData.push(Math.min(from, running));
      up.push(s.value >= 0 ? Math.abs(s.value) : null);
      down.push(s.value < 0 ? Math.abs(s.value) : null);
      total.push(null);
    } else {
      running = s.value;
      startEnd.push({ from: 0, to: running });
      baseData.push(0);
      up.push(null);
      down.push(null);
      total.push(s.value);
    }
  }
  return {
    ...o,
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: rgba(t.rgb.line, 0.08) } },
      formatter: (params: unknown) => {
        const ps = (Array.isArray(params) ? params : [params]) as { dataIndex: number }[];
        const i = ps[0]?.dataIndex ?? 0;
        const s = c.steps[i];
        if (!s) return '';
        const rows: TipRow[] =
          s.kind === 'step'
            ? [{ label: 'Change', value: c.valueFormat(s.value), tone: s.value >= 0 ? 'pos' : 'neg' }, { label: 'Running total', value: c.valueFormat(startEnd[i].to) }]
            : [{ label: 'Total', value: c.valueFormat(s.value) }];
        return tipHtml(t, s.label, rows);
      },
    },
    xAxis: {
      type: 'category',
      data: c.steps.map((s) => s.label),
      ...axisCommon(t),
      axisLabel: { color: t.muted, fontSize: 10, interval: 0, width: 54, overflow: 'break', fontFamily: t.mono },
    },
    yAxis: valueAxis(t, compact, { scale: false }),
    series: [
      { name: 'base', type: 'bar', stack: 'wf', data: baseData, silent: true, itemStyle: { color: 'transparent' }, tooltip: { show: false } },
      { name: 'Gain', type: 'bar', stack: 'wf', data: up, barMaxWidth: 34, itemStyle: { color: t.success, borderRadius: [6, 6, 0, 0] } },
      { name: 'Loss', type: 'bar', stack: 'wf', data: down, barMaxWidth: 34, itemStyle: { color: t.danger, borderRadius: [0, 0, 6, 6] } },
      { name: 'Total', type: 'bar', stack: 'wf', data: total, barMaxWidth: 34, itemStyle: { color: t.primary, borderRadius: [6, 6, 0, 0] } },
    ],
  } as EChartsOption;
}

// ───────────────────────── treemap ─────────────────────────

export type TreeNode = {
  name: string;
  value?: number;
  color?: string;
  /** Set on a stock leaf so a click can open the company. */
  ticker?: string;
  children?: TreeNode[];
};
export type TreemapCfg = {
  root: TreeNode[];
  valueFormat: (n: number) => string;
  total: number;
};

export function treemapOption(t: ChartTokens, c: TreemapCfg): EChartsOption {
  const paint = (n: TreeNode, color?: string): Record<string, unknown> => {
    const col = n.color ?? color ?? t.other;
    return {
      name: n.name,
      value: n.value,
      ticker: n.ticker,
      itemStyle: { color: col },
      children: n.children?.map((ch) => paint(ch, col)),
    };
  };
  return {
    animationDuration: 400,
    textStyle: { fontFamily: t.font, color: t.muted },
    aria: { enabled: true, decal: { show: false } },
    tooltip: {
      confine: true,
      backgroundColor: t.popover,
      borderColor: t.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: t.text, fontSize: 12, fontFamily: t.font },
      extraCssText: 'border-radius:10px;',
      formatter: (p: { name: string; value: number; treePathInfo?: { name: string }[] }) => {
        const path = (p.treePathInfo ?? []).map((x) => x.name).filter(Boolean);
        return tipHtml(t, path.join(' › ') || p.name, [
          { label: 'Value', value: c.valueFormat(p.value) },
          { label: 'Share', value: `${c.total > 0 ? ((p.value / c.total) * 100).toFixed(1) : '0.0'}%` },
        ]);
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: 'zoomToNode',
        breadcrumb: { show: false },
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        label: { show: true, color: t.text, fontSize: 11, fontWeight: 600, overflow: 'truncate' },
        upperLabel: { show: true, height: 22, color: t.text, fontSize: 11, fontWeight: 700 },
        itemStyle: { borderColor: t.popover, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        levels: [
          { itemStyle: { borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } },
          { itemStyle: { borderColor: t.popover, borderWidth: 3, gapWidth: 2 }, upperLabel: { show: true } },
          { colorSaturation: [0.55, 0.85], itemStyle: { borderWidth: 1, gapWidth: 1 } },
        ],
        data: c.root.map((n) => paint(n)),
      },
    ],
  } as EChartsOption;
}

// ───────────────────────── calendar heatmap (years × months) ─────────────────────────

export type HeatmapCfg = {
  /** Column labels, for example the 12 months. */
  cols: string[];
  /** Row labels, for example the years. */
  rows: string[];
  /** [col, row, value] */
  cells: [number, number, number][];
  color: string;
  valueFormat: (n: number) => string;
  title?: (col: number, row: number) => string;
};

export function heatmapOption(t: ChartTokens, c: HeatmapCfg): EChartsOption {
  const o = base(t, { top: 6, right: 8, bottom: 4, left: 4 });
  const max = Math.max(1, ...c.cells.map((x) => x[2]));
  const rgbOf =
    c.color === t.success ? t.rgb.success : c.color === t.danger ? t.rgb.danger : t.rgb.primary;
  return {
    ...o,
    tooltip: {
      ...(o.tooltip as object),
      trigger: 'item',
      formatter: (params: unknown) => {
        const [col, row, v] = (params as { value: [number, number, number] }).value;
        return tipHtml(t, c.title ? c.title(col, row) : `${c.cols[col]} ${c.rows[row]}`, [
          { label: 'Amount', value: c.valueFormat(v) },
        ]);
      },
    },
    xAxis: { type: 'category', data: c.cols, splitArea: { show: false }, ...axisCommon(t) },
    yAxis: { type: 'category', data: c.rows, inverse: true, ...axisCommon(t) },
    visualMap: {
      show: false,
      type: 'continuous',
      min: 0,
      max,
      dimension: 2,
      inRange: { color: [rgba(rgbOf, 0.06), rgba(rgbOf, 0.95)] },
    },
    series: [
      {
        type: 'heatmap',
        data: c.cells,
        itemStyle: { borderColor: t.popover, borderWidth: 2, borderRadius: 5 },
        emphasis: { itemStyle: { borderColor: t.text } },
      },
    ],
  } as EChartsOption;
}
