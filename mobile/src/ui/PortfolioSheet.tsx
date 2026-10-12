import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { ALL_PORTFOLIOS } from '@shared/portfolio-account.ts';
import { addContents, contentsLabel, portfolioContents, type Contents } from '@/data/scope';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from './Icon';
import { Button, Sheet, useKitStyles } from './kit';

/** The portfolio chooser: a bottom sheet with All portfolios and every portfolio below it, whatever it holds. */
export function PortfolioSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  // Counting what each portfolio holds is only done while the sheet is open.
  const rows = useMemo(() => {
    if (!visible) return { each: [], all: { stocks: 0, plans: 0, funds: 0, metals: 0 } };
    const entries = p.account?.portfolios ?? [];
    const each = entries.map((e) => ({ id: e.id, name: e.name, locked: Boolean(e.locked), contents: portfolioContents(e.portfolio) }));
    const all: Contents = each.reduce((sum, e) => addContents(sum, e.contents), { stocks: 0, plans: 0, funds: 0, metals: 0 });
    return { each, all };
  }, [p.account, visible]);
  const current = p.isAll ? ALL_PORTFOLIOS : (p.targetId ?? ALL_PORTFOLIOS);

  const options = [{ id: ALL_PORTFOLIOS, name: 'All portfolios', locked: false, contents: rows.all }, ...rows.each];
  return (
    <Sheet visible={visible} title="Choose a portfolio" onClose={onClose}>
      <View style={[styles.card, { padding: 0, overflow: 'hidden' }]} accessibilityRole="radiogroup">
        {options.map((o, i) => {
          const on = o.id === current;
          return (
            <Pressable
              key={o.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${o.name}, ${contentsLabel(o.contents)}${o.locked ? ', locked' : ''}${on ? ', selected' : ''}`}
              onPress={() => {
                p.select(o.id);
                onClose();
              }}
              style={({ pressed }) => [styles.listRow, { minHeight: 64 }, i < options.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }, pressed && { backgroundColor: colors.raised }]}
            >
              <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? colors.primary : colors.outline, alignItems: 'center', justifyContent: 'center' }}>
                {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.strong} numberOfLines={1}>{o.name}</Text>
                <Text style={styles.muted} numberOfLines={2}>{contentsLabel(o.contents)}{o.locked ? ' · locked' : ''}</Text>
              </View>
              {o.id === ALL_PORTFOLIOS ? <Icon name="pie" size={18} color={colors.muted} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Button
        label="Create or manage portfolios"
        variant="text"
        onPress={() => {
          onClose();
          router.push('/portfolios');
        }}
      />
    </Sheet>
  );
}
