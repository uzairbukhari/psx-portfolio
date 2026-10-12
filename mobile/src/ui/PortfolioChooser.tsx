// Portfolio chooser: a 48 dp pill in the app bar and a sheet listing All portfolios plus each portfolio with its
// value, share of net worth and what it holds. Selection animates (radio dot springs in, row tint fades), then the
// sheet closes, so the choice is confirmed before the screen behind it changes.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { layout, radii, type } from '@/theme/tokens';
import { AnimatedSheet } from './AnimatedSheet';
import { Icon } from './Icon';
import { motion, usePressScale, useReduceMotion } from './motion';

export type PortfolioOption = {
  id: string;
  name: string;
  /** What it holds, e.g. "21 stocks · 1 plan". */
  detail: string;
  /** Formatted value, e.g. "Rs 856,301". */
  value?: string | null;
  /** Share of net worth, 0 to 100 (omit for "All portfolios"). */
  share?: number | null;
  locked?: boolean;
};

/** The trigger. Shows the current scope; the chevron turns while the sheet is open. */
export function PortfolioPill({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [turn] = useState(() => new Animated.Value(open ? 1 : 0));
  useEffect(() => {
    Animated.timing(turn, { toValue: open ? 1 : 0, duration: reduce ? 0 : motion.base, easing: motion.easeOut, useNativeDriver: true }).start();
  }, [open, turn, reduce]);
  const press = usePressScale(0.96, reduce);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Portfolio: ${label}. Choose another`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      {...press.handlers}
      // 32 dp pill + 8 dp slop above and below = 48 dp target (the current pill is about 36 dp).
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
      style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            press.style,
            { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, borderRadius: radii.pill, paddingLeft: 12, paddingRight: 8, backgroundColor: pressed ? colors.raised : colors.primarySoft },
          ]}
        >
          <Text numberOfLines={1} style={{ color: colors.primary, ...type.overline, fontSize: 13, letterSpacing: 0, flexShrink: 1 }}>
            {label}
          </Text>
          <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
            <Icon name="chevronDown" size={16} color={colors.primary} strokeWidth={2.4} />
          </Animated.View>
        </Animated.View>
      )}
    </Pressable>
  );
}

export function PortfolioChooser({
  visible,
  options,
  selectedId,
  onSelect,
  onManage,
  onClose,
}: {
  visible: boolean;
  /** "All portfolios" first, then each portfolio. */
  options: PortfolioOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  // Local echo so the radio animates immediately; the real selection is applied as the sheet closes.
  const [echo, setEcho] = useState<string | null>(null);
  const picked = echo ?? selectedId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Stable, so the memoised rows do not re-render when the parent does.
  const choose = useCallback(
    (id: string) => {
      setEcho(id);
      if (timer.current) clearTimeout(timer.current);
      // Let the radio animation land (one motion.base) before the screen behind re-renders for the new scope.
      timer.current = setTimeout(() => {
        onSelect(id);
        onClose();
        setEcho(null);
      }, motion.base);
    },
    [onSelect, onClose],
  );

  return (
    <AnimatedSheet
      visible={visible}
      title="Choose a portfolio"
      onClose={onClose}
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={onManage}
          style={({ pressed }) => ({ minHeight: layout.minTarget, borderRadius: radii.control, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: pressed ? colors.raised : 'transparent' })}
        >
          <Icon name="edit" size={18} color={colors.primary} />
          <Text style={{ color: colors.primary, ...type.headline, fontSize: 15 }}>Create or manage portfolios</Text>
        </Pressable>
      }
    >
      <View accessibilityRole="radiogroup" style={{ borderRadius: radii.card, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
        {options.map((o, i) => (
          <ChooserRow key={o.id} option={o} selected={o.id === picked} last={i === options.length - 1} onPress={choose} />
        ))}
      </View>
    </AnimatedSheet>
  );
}

const ChooserRow = memo(function ChooserRow({ option: o, selected, last, onPress }: { option: PortfolioOption; selected: boolean; last: boolean; onPress: (id: string) => void }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const [on] = useState(() => new Animated.Value(selected ? 1 : 0));
  useEffect(() => {
    const to = selected ? 1 : 0;
    if (reduce) on.setValue(to);
    else Animated.spring(on, { toValue: to, useNativeDriver: true, ...motion.spring, stiffness: 380 }).start();
  }, [selected, on, reduce]);
  const share = o.share ?? null;
  const spoken = [o.name, o.value ?? '', share === null ? '' : `${share.toFixed(1)} percent of net worth`, o.detail, o.locked ? 'locked' : ''].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken}
      onPress={() => onPress(o.id)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: pressed ? colors.raised : colors.surface,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.line,
      })}
    >
      {/* Selected tint fades in under the row content. */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.primarySoft, opacity: on.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) }} />
      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? colors.primary : colors.outline, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, transform: [{ scale: on }] }} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ color: colors.ink, ...type.headline, flexShrink: 1 }}>
            {o.name}
          </Text>
          {o.locked ? <Icon name="lock" size={14} color={colors.warn} /> : null}
        </View>
        <Text numberOfLines={1} style={{ color: colors.muted, ...type.caption }}>
          {o.detail}
        </Text>
        {share !== null ? (
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.raised, marginTop: 6, overflow: 'hidden' }}>
            {/* Share bar: scaleX from the left edge, so it stays on the native driver if it is ever animated. */}
            <View style={{ height: 4, width: '100%', borderRadius: 2, backgroundColor: colors.primary, transformOrigin: 'left', transform: [{ scaleX: Math.max(0.02, Math.min(1, share / 100)) }] }} />
          </View>
        ) : null}
      </View>
      {o.value ? (
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text style={{ color: colors.ink, ...type.number }}>{o.value}</Text>
          {share !== null ? <Text style={{ color: colors.muted, ...type.caption, fontVariant: ['tabular-nums'] }}>{share.toFixed(1)}%</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
});
