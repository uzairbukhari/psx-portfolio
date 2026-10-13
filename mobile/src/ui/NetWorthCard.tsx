// Net worth hero with an animated allocation donut. Used on Portfolio in place of the old OverviewHero + AssetMix.
//  - Headline figure uses the display token (tabular figures) and rises in when it changes.
//  - The donut draws each asset class in sequence on mount; tapping a legend row (or the donut) focuses that class:
//    its arc thickens, the others dim and the centre shows the class's value and share.
//  - Reduce Motion: everything appears in its final state.
// The arc sweep is a Reanimated shared value driving strokeDashoffset through useAnimatedProps, so it runs on the UI
// thread (react-native's own Animated cannot drive an SVG prop natively). Needs the native build with Reanimated.
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Reanimated, { Easing as ReanimatedEasing, Extrapolation, interpolate, useAnimatedProps, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { moneyShort } from '@shared/portfolio.ts';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedMoney, signedPercent } from '@/data/format';
import type { Palette } from '@/theme/palette';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radii, space, type } from '@/theme/tokens';
import { Icon } from './Icon';
import { motion, useChangePulse, useReduceMotion } from './motion';

export type AllocationSlice = { key: keyof Palette['assets']; label: string; value: number; /** 0 to 100 */ share: number; gain: number | null };

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);
const SWEEP_EASE = ReanimatedEasing.bezier(0.2, 0, 0, 1);

const SIZE = 128;
const STROKE = 14;
const STROKE_FOCUS = 20;
const R = (SIZE - STROKE_FOCUS) / 2;
const C = 2 * Math.PI * R;
const CENTER = SIZE / 2;

export function NetWorthCard({
  label,
  value,
  gain,
  gainPercent,
  invested,
  yearlyReturn,
  dividends,
  slices,
  footnote,
}: {
  label: string;
  value: number;
  gain: number | null;
  gainPercent: number | null;
  invested: number | null;
  /** Money-weighted yearly return as a fraction (0.075 = 7.5 %), or null before 90 days of history. */
  yearlyReturn: number | null;
  dividends?: { label: string; value: number };
  slices: AllocationSlice[];
  footnote?: string;
}) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [focus, setFocus] = useState<AllocationSlice['key'] | null>(null);
  // Drop a focus that no longer exists (switching portfolio removes a class).
  const focused = slices.find((s) => s.key === focus) ?? null;
  const toggle = useCallback((key: AllocationSlice['key']) => setFocus((f) => (f === key ? null : key)), []);

  const headline = moneyShort(value);
  const rise = useChangePulse(headline, { reduce });

  const summary = [
    `${label}, ${headline}`,
    gain === null ? 'gain not yet known' : `unrealised ${signedAmountLabel(gain)}${gainPercent === null ? '' : `, ${signedPercentLabel(gainPercent)}`}`,
    invested === null ? '' : `invested ${moneyShort(invested)}`,
    yearlyReturn === null ? '' : `yearly return ${signedPercentLabel(yearlyReturn * 100)}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={{ backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radii.card, padding: 20, gap: space.lg }}>
      {/* Headline block: read as one sentence by screen readers. */}
      <View accessible accessibilityLabel={summary} style={{ gap: space.xs }}>
        <Text style={{ color: colors.muted, ...type.overline }}>{label}</Text>
        <Animated.Text
          style={{ color: colors.ink, ...type.display, opacity: rise.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}
        >
          {headline}
        </Animated.Text>
        {gain === null ? (
          <Text style={{ color: colors.muted, ...type.caption }}>Gain not yet known</Text>
        ) : (
          <GainLine gain={gain} percent={gainPercent} />
        )}
      </View>

      {slices.length > 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Donut slices={slices} focus={focused?.key ?? null} onToggle={toggle} reduce={reduce} total={headline} />
          <View style={{ flex: 1, gap: 2 }} accessibilityRole="radiogroup" accessibilityLabel="Asset mix">
            {slices.map((s) => (
              <LegendRow key={s.key} slice={s} focused={focused?.key === s.key} dimmed={focused !== null && focused.key !== s.key} onPress={toggle} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ height: 1, backgroundColor: colors.line }} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Figure label="Invested" value={invested === null ? '—' : moneyShort(invested)} />
        <Figure label="Yearly return" value={yearlyReturn === null ? '—' : signedPercent(yearlyReturn * 100)} tone={yearlyReturn === null ? undefined : yearlyReturn >= 0 ? colors.gain : colors.loss} />
        {dividends ? <Figure label={dividends.label} value={moneyShort(dividends.value)} /> : null}
      </View>
      {footnote ? <Text style={{ color: colors.muted, ...type.caption }}>{footnote}</Text> : null}
    </View>
  );
}

function GainLine({ gain, percent }: { gain: number; percent: number | null }) {
  const { colors } = useTheme();
  const up = gain > 0;
  const tone = gain === 0 ? colors.muted : up ? colors.gain : colors.loss;
  const soft = gain === 0 ? colors.raised : up ? colors.gainSoft : colors.lossSoft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {gain !== 0 ? <Icon name={up ? 'arrowUp' : 'arrowDown'} size={16} color={tone} strokeWidth={2.6} /> : null}
        <Text style={{ color: tone, ...type.number, fontSize: 17, lineHeight: 22, fontWeight: '700' }}>{signedMoney(gain)}</Text>
      </View>
      {percent !== null ? (
        <View style={{ backgroundColor: soft, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
          <Text style={{ color: tone, ...type.number, fontSize: 13, lineHeight: 18 }}>{signedPercent(percent)}</Text>
        </View>
      ) : null}
      <Text style={{ color: colors.muted, ...type.caption }}>unrealised</Text>
    </View>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '600' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
      <Text style={{ color: tone ?? colors.ink, ...type.number }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

const Donut = memo(function Donut({
  slices,
  focus,
  onToggle,
  reduce,
  total,
}: {
  slices: AllocationSlice[];
  focus: AllocationSlice['key'] | null;
  onToggle: (key: AllocationSlice['key']) => void;
  reduce: boolean;
  total: string;
}) {
  const { colors } = useTheme();
  const progress = useSharedValue(reduce ? 1 : 0);
  const [pop] = useState(() => new Animated.Value(1));
  // Re-sweep when the mix itself changes (another portfolio), not when a price moves a share by a fraction.
  const shape = slices.map((s) => `${s.key}:${Math.round(s.share)}`).join('|');
  useEffect(() => {
    if (reduce) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.slow, easing: SWEEP_EASE });
  }, [shape, reduce, progress]);
  useEffect(() => {
    if (reduce) return;
    pop.setValue(0.96);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, ...motion.spring, stiffness: 380 }).start();
  }, [focus, reduce, pop]);

  const arcs = useMemo(() => {
    const gap = slices.length > 1 ? 3 : 0;
    const spans = slices.map((s) => (Math.max(0, s.share) / 100) * C);
    const starts = spans.map((_, i) => spans.slice(0, i).reduce((a, b) => a + b, 0));
    return slices.map((s, i) => {
      const len = Math.max(1, spans[i] - gap);
      return { key: s.key, len, from: starts[i] / C, to: (starts[i] + len) / C };
    });
  }, [slices]);

  const focused = slices.find((s) => s.key === focus) ?? null;
  const pulse = useChangePulse(focus, { reduce });

  return (
    <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale: pop }] }}>
      <Svg width={SIZE} height={SIZE} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Circle cx={CENTER} cy={CENTER} r={R} stroke={colors.raised} strokeWidth={STROKE} fill="none" />
        <G>
          {arcs.map((a) => {
            const on = focus === a.key;
            return (
              <DonutArc
                key={a.key}
                arc={a}
                progress={progress}
                color={colors.assets[a.key]}
                strokeWidth={on ? STROKE_FOCUS : STROKE}
                opacity={focus === null || on ? 1 : 0.3}
                onPress={() => onToggle(a.key)}
              />
            );
          })}
        </G>
      </Svg>
      {/* Centre label: the total, or the focused class. */}
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: STROKE_FOCUS + 6, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }}
      >
        <Text numberOfLines={1} style={{ color: colors.muted, ...type.caption, fontSize: 12 }}>
          {focused ? focused.label : 'Total'}
        </Text>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: colors.ink, ...type.number, fontSize: 15 }}>
          {focused ? `${focused.share.toFixed(1)}%` : total}
        </Text>
      </Animated.View>
    </Animated.View>
  );
});

type Arc = { key: string; len: number; from: number; to: number };

/** One asset-class arc. Its own component because useAnimatedProps is a hook. */
function DonutArc({ arc, progress, color, strokeWidth, opacity, onPress }: { arc: Arc; progress: SharedValue<number>; color: string; strokeWidth: number; opacity: number; onPress: () => void }) {
  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(progress.value, [arc.from, Math.max(arc.to, arc.from + 0.0001)], [arc.len, 0], Extrapolation.CLAMP),
  }));
  return (
    <AnimatedCircle
      cx={CENTER}
      cy={CENTER}
      r={R}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeOpacity={opacity}
      strokeLinecap="butt"
      strokeDasharray={[arc.len, C]}
      animatedProps={animatedProps}
      rotation={-90 + arc.from * 360}
      origin={`${CENTER}, ${CENTER}`}
      onPress={onPress}
    />
  );
}

const LegendRow = memo(function LegendRow({ slice: s, focused, dimmed, onPress }: { slice: AllocationSlice; focused: boolean; dimmed: boolean; onPress: (key: AllocationSlice['key']) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={`${s.label}, ${moneyShort(s.value)}, ${s.share.toFixed(1)} percent${s.gain === null ? '' : `, ${signedAmountLabel(s.gain)}`}`}
      accessibilityHint="Highlights this part of the chart"
      onPress={() => onPress(s.key)}
      style={({ pressed }) => ({
        minHeight: layout.minTarget,
        justifyContent: 'center',
        paddingHorizontal: 8,
        marginHorizontal: -8,
        borderRadius: radii.control,
        backgroundColor: focused ? colors.raised : pressed ? colors.raised : 'transparent',
        opacity: dimmed ? 0.55 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors.assets[s.key] }} />
        <Text numberOfLines={2} style={{ color: colors.ink, ...type.caption, fontWeight: '600', flex: 1 }}>
          {s.label}
        </Text>
        <Text style={{ color: colors.muted, ...type.caption, fontVariant: ['tabular-nums'] }}>{s.share.toFixed(0)}%</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ color: colors.ink, ...type.number, fontSize: 13, lineHeight: 18, marginLeft: 18 }}>
        {moneyShort(s.value)}
      </Text>
    </Pressable>
  );
});
