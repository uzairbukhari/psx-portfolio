import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius } from '@/theme/tokens';

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
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  return (
    <View style={[styles.notice, tone === 'error' && styles.noticeError]}>
      <Text style={[styles.noticeText, tone === 'error' && { color: colors.danger }]}>{children}</Text>
    </View>
  );
}

export function Amount({ value, text, size = 16 }: { value: number | null; text: string; size?: number }) {
  const color = value === null || value === 0 ? colors.foreground : value > 0 ? colors.success : colors.danger;
  return <Text style={{ color, fontSize: size, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{text}</Text>;
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: radius, padding: 16, gap: 8 },
  title: { color: colors.foreground, fontSize: 26, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  text: { color: colors.foreground, fontSize: 16 },
  strong: { color: colors.foreground, fontSize: 16, fontWeight: '600' },
  notice: { backgroundColor: 'rgba(211,154,41,0.14)', borderColor: 'rgba(211,154,41,0.32)', borderWidth: 1, borderRadius: 10, padding: 12 },
  noticeError: { backgroundColor: 'rgba(255,93,108,0.14)', borderColor: 'rgba(255,93,108,0.3)' },
  noticeText: { color: '#e8c27a', fontSize: 13, lineHeight: 18 },
  stat: { flex: 1, gap: 4 },
  statLabel: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.primaryForeground, fontWeight: '600', fontSize: 15 },
  secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: colors.foreground, fontSize: 15 },
  divider: { height: 1, backgroundColor: colors.border },
});
