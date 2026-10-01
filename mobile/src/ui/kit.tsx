import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedMoney, signedPercent } from '@/data/format';
import { stepStates } from '@/data/progress';
import { layout, radii, type } from '@/theme/tokens';
import { makeStyles, useTheme } from '@/theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

/** True when the phone asks for reduced motion ("Remove animations" on Android). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  edges = ['top'],
  fab = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  edges?: ('top' | 'bottom')[];
  /** Leaves room under the content for the floating Add button. */
  fab?: boolean;
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <ScrollView
        contentContainerStyle={[styles.content, fab && { paddingBottom: 112 }]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Screen heading with an optional subtitle and a right-hand action. */
export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const styles = useKitStyles();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[styles.muted, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({
  children,
  style,
  onPress,
  tone = 'default',
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  tone?: 'default' | 'hero';
  /** Reads the whole card as one item with this label (use for summary cards). */
  accessibilityLabel?: string;
}) {
  const styles = useKitStyles();
  const base = [styles.card, tone === 'hero' && styles.cardHero, style];
  if (!onPress)
    return (
      <View style={base} accessible={accessibilityLabel ? true : undefined} accessibilityLabel={accessibilityLabel}>
        {children}
      </View>
    );
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.8 }]}>
      {children}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const styles = useKitStyles();
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Overline label (sentence case) that introduces a card or a group of cards, with an optional action. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const styles = useKitStyles();
  return (
    <View style={[styles.row, { marginTop: 4 }]}>
      <Text style={styles.sectionLabel} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const styles = useKitStyles();
  return <Text style={styles.muted}>{children}</Text>;
}

type NoticeTone = 'info' | 'warn' | 'error' | 'offline' | 'success';

/** Inline message with an icon and at most one action. Colour is never the only signal: the icon differs per tone. */
export function Notice({
  children,
  tone = 'warn',
  action,
}: {
  children: ReactNode;
  tone?: NoticeTone;
  action?: { label: string; onPress: () => void };
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const palette = {
    info: [colors.primarySoft, colors.primary, 'info'],
    warn: [colors.warnSoft, colors.warn, 'alert'],
    error: [colors.lossSoft, colors.loss, 'alert'],
    offline: [colors.raised, colors.muted, 'offline'],
    success: [colors.gainSoft, colors.gain, 'check'],
  }[tone] as [string, string, IconName];
  return (
    <View
      style={[styles.notice, { backgroundColor: palette[0] }]}
      accessibilityRole={tone === 'error' || tone === 'warn' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'error' || tone === 'warn' ? undefined : 'polite'}
    >
      <Icon name={palette[2]} size={18} color={palette[1]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.noticeText, { color: palette[1] }]}>{children}</Text>
        {action ? (
          <Pressable accessibilityRole="button" accessibilityLabel={action.label} onPress={action.onPress} hitSlop={8} style={{ minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <Text style={[styles.noticeText, { color: palette[1], fontWeight: '700', textDecorationLine: 'underline' }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * A gain/loss figure: signed (+/−), with an arrow glyph, coloured as well. Readers hear "gain of Rs 1,200" or
 * "loss of Rs 300"; the text wraps and scales with the system font size (no shrink-to-fit).
 */
export function Amount({
  value,
  text,
  size = 15,
  label,
  percent = false,
  arrow = true,
  weight = '600',
}: {
  value: number | null;
  /** Overrides the signed amount text (for example a percentage). */
  text?: string;
  size?: number;
  /** Names what the figure is, for readers ("Unrealised"). */
  label?: string;
  percent?: boolean;
  arrow?: boolean;
  weight?: '400' | '600' | '700';
}) {
  const { colors } = useTheme();
  const color = value === null || value === 0 ? colors.muted : value > 0 ? colors.gain : colors.loss;
  const spoken = percent ? signedPercentLabel(value) : signedAmountLabel(value);
  const shown = text ?? (percent ? signedPercent(value) : signedMoney(value));
  return (
    <View accessible accessibilityLabel={label ? `${label}, ${spoken}` : spoken} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
      {arrow && value !== null && value !== 0 ? <Icon name={value > 0 ? 'arrowUp' : 'arrowDown'} size={Math.round(size * 0.95)} color={color} strokeWidth={2.4} /> : null}
      <Text style={{ color, fontSize: size, lineHeight: Math.round(size * 1.35), fontWeight: weight, fontVariant: ['tabular-nums'], flexShrink: 1 }}>{shown}</Text>
    </View>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  const styles = useKitStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'tonal' | 'outline' | 'text' | 'destructive';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const fg = { primary: colors.onPrimary, tonal: colors.primary, outline: colors.ink, text: colors.primary, destructive: colors.loss }[variant];
  const bg = { primary: colors.primary, tonal: colors.primarySoft, outline: 'transparent', text: 'transparent', destructive: colors.lossSoft }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.outline },
        variant === 'text' && { paddingHorizontal: 8 },
        pressed && { opacity: 0.75 },
        inactive && { opacity: 0.5 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Text field with a label, focus ring and inline error. */
export function Input({ label, hint, error, style, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[styles.input, focused && { borderColor: colors.primary, borderWidth: 2 }, error ? { borderColor: colors.loss } : null, style]}
      />
      {error ? <Text style={[styles.muted, { color: colors.loss }]}>{error}</Text> : hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

/** Filter chip: a toggle with a `selected` state (a tick as well as colour). 40 dp tall plus hit slop = 48 dp. */
export function Chip({ label, selected, onPress, accessibilityLabel, role = 'button' }: { label: string; selected?: boolean; onPress?: () => void; accessibilityLabel?: string; role?: 'button' | 'tab' | 'radio' }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole={role}
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.7 }]}
    >
      {selected ? <Icon name="check" size={14} color={colors.primary} strokeWidth={2.6} /> : null}
      <Text style={{ color: selected ? colors.primary : colors.ink, fontSize: 14, lineHeight: 20, fontWeight: selected ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

type StatusTone = 'neutral' | 'success' | 'danger' | 'primary' | 'warn';

/** Non-interactive status chip: icon plus word ("Stale price", "Expected", "Received"). */
export function StatusChip({ text, tone = 'neutral', icon }: { text: string; tone?: StatusTone; icon?: IconName }) {
  const { colors } = useTheme();
  const [bg, fg, glyph] = (
    {
      neutral: [colors.raised, colors.muted, undefined],
      success: [colors.gainSoft, colors.gain, 'check'],
      danger: [colors.lossSoft, colors.loss, 'alert'],
      primary: [colors.primarySoft, colors.primary, 'info'],
      warn: [colors.warnSoft, colors.warn, 'alert'],
    } as const
  )[tone];
  const name = icon ?? glyph;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, maxWidth: '100%' }}>
      {name ? <Icon name={name} size={12} color={fg} strokeWidth={2.4} /> : null}
      <Text style={{ color: fg, ...type.overline, letterSpacing: 0, flexShrink: 1 }}>{text}</Text>
    </View>
  );
}

/** Segmented control (Holdings | Insights, Targets | Monthly Picks). Each segment is a 48 dp tab. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string; spoken?: string }[]; value: T; onChange: (key: T) => void; label: string }) {
  const styles = useKitStyles();
  return (
    <View style={styles.segmented} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityLabel={o.spoken ?? o.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Bottom sheet over the current screen: grab handle, title, scrollable body, closes on the scrim or back. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title?: string; onClose: () => void; children: ReactNode }) {
  const styles = useKitStyles();
  const reduce = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduce ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.scrim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.grab} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          {title ? (
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            {children}
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Round-cornered ticker monogram on a stable tint (ink text, so contrast holds in both themes). */
export function Avatar({ ticker, size = 40 }: { ticker: string; size?: number }) {
  const { colors } = useTheme();
  let hash = 0;
  for (const ch of ticker) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const tint = colors.tints[hash % colors.tints.length];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: Math.max(10, Math.round(size * 0.3)) }} allowFontScaling={false}>
        {ticker.slice(0, 4)}
      </Text>
    </View>
  );
}

export function ProgressBar({ fraction, tone, height = 8 }: { fraction: number; tone?: string; height?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, borderRadius: height / 2, backgroundColor: colors.raised, overflow: 'hidden' }}
    >
      <View style={{ height, borderRadius: height / 2, width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, backgroundColor: tone ?? colors.primary }} />
    </View>
  );
}

/** Row of steps filling toward a goal: mint = reached, primary = in progress, raised = to go. Decorative; the text beside it says the numbers. */
export function StepsBar({ fraction, steps = 6 }: { fraction: number; steps?: number }) {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: 6 }}>
      {stepStates(fraction, steps).map((s, i) => (
        <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: s === 'done' ? colors.brandMint : s === 'on' ? colors.primary : colors.raised }} />
      ))}
    </View>
  );
}

/** A tappable list row (at least 56 dp) with title, subtitle and a right-hand value; used inside a padding-less Card. */
export function ListRow({
  title,
  subtitle,
  right,
  left,
  onPress,
  last,
  accessibilityLabel,
  accessibilityHint,
  wrapTitle = false,
  footer,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  /** Spoken in full for the row (defaults to title and subtitle); use it to include the right-hand value. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Lets the title use two lines (large font scales always do). */
  wrapTitle?: boolean;
  /** Extra content under the subtitle (status chips). */
  footer?: ReactNode;
}) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityHint={onPress ? accessibilityHint : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.raised }]}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.strong} numberOfLines={wrapTitle ? 2 : 1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.muted} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {footer}
      </View>
      {right}
      {onPress ? <Icon name="chevronRight" size={16} color={colors.muted} /> : null}
    </Pressable>
  );
}

/** Card section that opens and closes (Insights). The header is one 48 dp button that says whether it is expanded. */
export function Collapsible({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[styles.card, { gap: 8 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: layout.minTarget, marginVertical: -8 }}
      >
        <Text style={[styles.strong, { flexShrink: 1 }]}>{title}</Text>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={20} color={colors.muted} />
        </View>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export function EmptyState({ icon = 'inbox', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={colors.muted} />
      </View>
      <Text style={[styles.strong, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[styles.muted, { textAlign: 'center' }]}>{body}</Text> : null}
      {action}
    </View>
  );
}

/** Grey placeholder block shaped like the content that is loading; it pulses unless Reduce Motion is on. */
export function Skeleton({ height = 16, width = '100%', radius = 8 }: { height?: number; width?: number | `${number}%`; radius?: number }) {
  const { colors } = useTheme();
  const reduce = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    if (reduce) {
      pulse.setValue(0.8);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, pulse]);
  return <Animated.View style={{ height, width, borderRadius: radius, backgroundColor: colors.raised, opacity: pulse }} />;
}

/** Skeleton cards that match the final layout while the first load is in flight. */
export function Loading({ cards = 3 }: { cards?: number }) {
  const styles = useKitStyles();
  return (
    <View style={{ gap: layout.cardGap }} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: cards }, (_, i) => (
        <View key={i} style={[styles.card, { gap: 12 }]}>
          <Skeleton height={12} width="35%" />
          <Skeleton height={i === 0 ? 40 : 20} width={i === 0 ? '70%' : '55%'} />
          <Skeleton height={12} width="90%" />
        </View>
      ))}
    </View>
  );
}

export const useKitStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { padding: layout.gutter, gap: layout.cardGap, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 4, minHeight: 48 },
  card: { backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: radii.card, padding: layout.cardPadding, gap: 10 },
  cardHero: { padding: 20, gap: 10 },
  title: { color: c.ink, ...type.title },
  sectionLabel: { color: c.muted, ...type.overline },
  muted: { color: c.muted, ...type.caption },
  text: { color: c.ink, ...type.body },
  strong: { color: c.ink, ...type.headline },
  number: { color: c.ink, ...type.number },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', borderRadius: radii.control, padding: 12 },
  noticeText: { ...type.caption, lineHeight: 19 },
  stat: { flex: 1, gap: 2 },
  statLabel: { color: c.muted, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radii.control, paddingVertical: 12, paddingHorizontal: 18, minHeight: layout.minTarget },
  btnText: { fontWeight: '600', fontSize: 15, lineHeight: 20, flexShrink: 1, textAlign: 'center' },
  input: { backgroundColor: c.surface, borderColor: c.outline, borderWidth: 1, borderRadius: radii.control, paddingHorizontal: 14, paddingVertical: 10, minHeight: layout.minTarget, color: c.ink, fontSize: 16 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, borderColor: c.outline, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: c.primary, backgroundColor: c.primarySoft },
  segmented: { flexDirection: 'row', backgroundColor: c.raised, borderRadius: radii.control, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  segmentText: { color: c.muted, fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  segmentTextOn: { color: c.ink, fontWeight: '700' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: c.raised, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
  scrim: { flex: 1, backgroundColor: c.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingHorizontal: layout.gutter, paddingTop: 8, paddingBottom: 12, gap: 12, maxHeight: '90%' },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.line, alignSelf: 'center', marginVertical: 4 },
}));
