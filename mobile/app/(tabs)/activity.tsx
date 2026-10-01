import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ACTIVITY_FILTERS, filterActivity, groupByMonth, type ActivityFilter } from '@/data/activity-view';
import { activityEntries } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { ActivityRow } from '@/ui/ActivityRow';
import { Chip, EmptyState, Header, Input, Loading, Notice, styles } from '@/ui/kit';

export default function Activity() {
  const p = usePortfolio();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio) : []), [p.portfolio]);
  const sections = useMemo(() => groupByMonth(filterActivity(entries, filter, query)), [entries, filter, query]);
  const shown = sections.reduce((n, s) => n + s.data.length, 0);
  const filtering = filter !== 'all' || query.trim() !== '';

  if (p.isLoading)
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <Loading />
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* A virtualised SectionList renders only the rows on screen, so a ledger of thousands of entries scrolls smoothly. */}
      <SectionList
        sections={sections}
        keyExtractor={(e) => e.id}
        stickySectionHeadersEnabled
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        windowSize={7}
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={p.isRefetching} onRefresh={() => void p.refetch()} tintColor={colors.primary} />}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <Header
              title="Activity"
              subtitle={
                entries.length
                  ? filtering
                    ? `${shown} of ${entries.length} entries match`
                    : `${entries.length} entries, newest first`
                  : undefined
              }
            />
            {p.error && !p.portfolio ? <Notice tone="error">{p.error.message}</Notice> : null}
            {entries.length ? (
              <>
                <Input
                  label="Search activity"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Ticker, date or text"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
                  {ACTIVITY_FILTERS.map((f) => (
                    <Chip key={f.key} role="radio" label={f.label} accessibilityLabel={`Show ${f.label.toLowerCase()}`} selected={filter === f.key} onPress={() => setFilter(f.key)} />
                  ))}
                </View>
              </>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: colors.background, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              {section.title} · {section.data.length}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={{ marginHorizontal: 16, backgroundColor: colors.card, borderColor: colors.border, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: index === 0 ? 1 : 0, borderBottomWidth: index === section.data.length - 1 ? 1 : 0, borderTopLeftRadius: index === 0 ? 14 : 0, borderTopRightRadius: index === 0 ? 14 : 0, borderBottomLeftRadius: index === section.data.length - 1 ? 14 : 0, borderBottomRightRadius: index === section.data.length - 1 ? 14 : 0, overflow: 'hidden' }}>
            <ActivityRow
              entry={item}
              last={index === section.data.length - 1}
              onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: item.ticker } })}
            />
          </View>
        )}
        ListEmptyComponent={
          entries.length === 0 ? (
            <EmptyState icon="activity" title="Nothing recorded yet" body="Trades and dividends you add or import will appear here." />
          ) : (
            <EmptyState icon="activity" title="No entries match" body="Try a different search or filter." />
          )
        }
      />
    </SafeAreaView>
  );
}
