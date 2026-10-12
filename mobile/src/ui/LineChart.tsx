import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { chartSummary } from '@/data/a11y';
import { useTheme } from '@/theme/ThemeProvider';

type Geometry = { line: string; area: string; up: boolean };

/** Path for the price chart: one pass for min/max (spreading thousands of values into Math.min is slow on Hermes) and about one point per pixel. */
function buildGeometry(points: [number, number][], width: number, height: number, pad: number): Geometry | null {
  if (width <= 0 || points.length < 2) return null;
  const step = Math.max(1, Math.floor(points.length / width));
  const pts = step === 1 ? points : points.filter((_, i) => i % step === 0 || i === points.length - 1);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
  const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
  return { line, area: `${line} L${sx(x1).toFixed(1)} ${height} L${sx(x0).toFixed(1)} ${height} Z`, up: pts[pts.length - 1][1] >= pts[0][1] };
}

/** Minimal price line with a soft fill. `points` are chronological [time, value] pairs. */
export function LineChart({ points, height = 150, label = 'Price chart' }: { points: [number, number][]; height?: number; label?: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const geometry = useMemo(() => buildGeometry(points, width, height, 6), [points, width, height]);
  const color = geometry?.up === false ? colors.loss : colors.gain;
  return (
    <View
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartSummary(points, label)}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {geometry ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.25} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={geometry.area} fill="url(#fill)" />
          <Path d={geometry.line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}

export type ChartSeries = { points: [number, number][]; color: string; dashed?: boolean; width?: number };

/**
 * Two or more lines on shared axes (value against money in, portfolio against the index). The lines differ by
 * stroke style as well as colour (the comparison is dashed), and `label` is the text alternative.
 */
export function MultiLineChart({ series, height = 170, label }: { series: ChartSeries[]; height?: number; label: string }) {
  const [width, setWidth] = useState(0);
  const pad = 6;
  const all = series.flatMap((s) => s.points);
  const paths: { d: string; s: ChartSeries }[] = [];
  if (width > 0 && all.length > 1) {
    const [x0, x1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
    const [y0, y1] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
    const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
    const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
    for (const s of series) paths.push({ s, d: s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ') });
  }
  return (
    <View style={{ height }} accessible accessibilityRole="image" accessibilityLabel={label} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {paths.length ? (
        <Svg width={width} height={height}>
          {paths.map(({ d, s }, i) => (
            <Path key={i} d={d} stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dashed ? '6 5' : undefined} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
