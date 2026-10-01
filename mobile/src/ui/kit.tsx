import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { colors, radii, radius, type } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  edges = ['top'],
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Large screen heading with an optional subtitle and a right-hand action. */
export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
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
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  tone?: 'default' | 'hero';
}) {
  const base = [styles.card, tone === 'hero' && styles.cardHero, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] }]}>
      {children}
    </Pressable>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

/** Small uppercase label that introduces a group of cards. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={[styles.row, { marginTop: 6 }]}>
      <Text style={styles.sectionLabel}>{children}</Text>
      {right}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  const error = tone === 'error';
  return (
    <View style={[styles.notice, error && styles.noticeError]} accessibilityRole="alert">
      <Icon name="alert" size={18} color={error ? colors.danger : colors.warn} />
      <Text style={[styles.noticeText, error && { color: colors.danger }]}>{children}</Text>
    </View>
  );
}

export function Amount({ value, text, size = 16 }: { value: number | null; text: string; size?: number }) {
  const color = value === null || value === 0 ? colors.foreground : value > 0 ? colors.success : colors.danger;
  return (
    <Text numberOfLines={1} adjustsFontSizeToFit style={{ color, fontSize: size, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
      {text}
    </Text>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  const fg = variant === 'primary' ? colors.primaryForeground : variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.primary : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.borderStrong },
        variant === 'danger' && { backgroundColor: colors.dangerSoft },
        variant === 'ghost' && { paddingVertical: 8 },
        pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
        inactive && { opacity: 0.45 },
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
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <TextInput
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
        style={[styles.input, focused && { borderColor: colors.primary }, error ? { borderColor: colors.danger } : null, style]}
      />
      {error ? <Text style={[styles.muted, { color: colors.danger }]}>{error}</Text> : hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: selected ? colors.primary : colors.foreground, fontSize: 14, fontWeight: selected ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'success' | 'danger' | 'primary' | 'warn' }) {
  const palette = {
    neutral: [colors.cardRaised, colors.muted],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    primary: [colors.primarySoft, colors.primary],
    warn: [colors.warnSoft, colors.warn],
  }[tone];
  return (
    <View style={{ backgroundColor: palette[0], borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: palette[1], fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const AVATAR_HUES = ['#3b82f6', '#22c1a0', '#a78bfa', '#f59e0b', '#ec4899', '#38bdf8', '#84cc16'];

/** Round ticker monogram; the colour is stable per ticker. */
export function Avatar({ ticker, size = 40 }: { ticker: string; size?: number }) {
  let hash = 0;
  for (const ch of ticker) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[hash % AVATAR_HUES.length];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: `${hue}26`, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: hue, fontWeight: '700', fontSize: size * 0.32 }}>{ticker.slice(0, 3)}</Text>
    </View>
  );
}

export function ProgressBar({ fraction, tone = colors.primary }: { fraction: number; tone?: string }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
      <View style={{ height: 6, borderRadius: 3, width: `${Math.max(0, Math.min(1, fraction)) * 100}%`, backgroundColor: tone }} />
    </View>
  );
}

/** A tappable list row with title, subtitle and a right-hand value; used inside a Card with no padding. */
export function ListRow({
  title,
  subtitle,
  right,
  left,
  onPress,
  last,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { backgroundColor: colors.cardRaised }]}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.strong} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.muted} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress ? <Icon name="chevronRight" size={16} color={colors.muted} /> : null}
    </Pressable>
  );
}

export function EmptyState({ icon = 'inbox', title, body, action }: { icon?: IconName; title: string; body?: string; action?: ReactNode }) {
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

/** Full-screen centred spinner used while the first load is in flight. */
export function Loading() {
  return (
    <View style={{ paddingVertical: 80, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 16, gap: 8 },
  cardHero: { backgroundColor: colors.cardRaised, borderColor: colors.borderStrong, padding: 20, gap: 10 },
  title: { color: colors.foreground, ...type.largeTitle },
  sectionLabel: { color: colors.muted, ...type.label, textTransform: 'uppercase' },
  muted: { color: colors.muted, ...type.caption },
  text: { color: colors.foreground, ...type.body },
  strong: { color: colors.foreground, ...type.headline },
  notice: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: colors.warnSoft, borderColor: 'rgba(211,154,41,0.32)', borderWidth: 1, borderRadius: radii.sm, padding: 12 },
  noticeError: { backgroundColor: colors.dangerSoft, borderColor: 'rgba(255,93,108,0.3)' },
  noticeText: { flex: 1, color: colors.warn, ...type.caption },
  stat: { flex: 1, gap: 4 },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // Legacy button looks, kept for screens that style a Pressable themselves.
  button: { backgroundColor: colors.primary, borderRadius: radii.md, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: colors.primaryForeground, fontWeight: '600', fontSize: 15 },
  secondary: { borderColor: colors.borderStrong, borderWidth: 1, borderRadius: radii.md, paddingVertical: 14, alignItems: 'center' },
  secondaryText: { color: colors.foreground, fontSize: 15, fontWeight: '500' },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, paddingVertical: 14, paddingHorizontal: 18, minHeight: 48 },
  btnText: { fontWeight: '600', fontSize: 15 },
  input: { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 12, color: colors.foreground, fontSize: 16 },
  chip: { borderColor: colors.border, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40, paddingHorizontal: 24 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
