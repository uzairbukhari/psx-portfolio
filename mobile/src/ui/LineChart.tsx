import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { chartSummary } from '@/data/a11y';
import { colors } from '@/theme/tokens';

/** Minimal price line with a soft fill. `points` are chronological [time, value] pairs. */
export function LineChart({ points, height = 150, label = 'Price chart' }: { points: [number, number][]; height?: number; label?: string }) {
  const [width, setWidth] = useState(0);
  const pad = 6;
  let line = '';
  let area = '';
  let up = true;
  if (width > 0 && points.length > 1) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
    const sx = (x: number) => pad + ((x - x0) / (x1 - x0 || 1)) * (width - pad * 2);
    const sy = (y: number) => height - pad - ((y - y0) / (y1 - y0 || 1)) * (height - pad * 2);
    line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
    area = `${line} L${sx(x1).toFixed(1)} ${height} L${sx(x0).toFixed(1)} ${height} Z`;
    up = ys[ys.length - 1] >= ys[0];
  }
  const color = up ? colors.success : colors.danger;
  return (
    <View
      style={{ height }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={chartSummary(points, label)}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {line ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.25} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
