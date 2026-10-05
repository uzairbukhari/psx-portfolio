import { AllPortfolios } from '@/ui/AllPortfolios';
import { useMemo, useState } from 'react';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ACTIVITY_FILTERS, filterActivity, groupByMonth, type ActivityFilter } from '@/data/activity-view';
import { activityEntries } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { ActivityRow } from '@/ui/ActivityRow';
import { AppBar } from '@/ui/AppBar';
import { Button, Chip, EmptyState, Input, Loading, Notice, useKitStyles } from '@/ui/kit';

export default function Activity() {
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [query, setQuery] = useState('');
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio) : []), [p.portfolio]);
  const sections = useMemo(() => groupByMonth(filterActivity(entries, filter, query)), [entries, filter, query]);
  const shown = sections.reduce((n, s) => n + s.data.length, 0);
  const filtering = filter !== 'all' || query.trim() !== '';

  if (p.isAll) return <AllPortfolios mode="activity" />;
  if (p.isLoading)
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={{ padding: 16, gap: 12 }}>
          <AppBar title="Activity" />
          <Loading />
        </View>
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
        contentContainerStyle={{ paddingBottom: 112 }}
        refreshControl={<RefreshControl refreshing={p.isRefetching} onRefresh={() => void p.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
        ListHeaderComponent={
          <View style={{ padding: 16, gap: 12 }}>
            <AppBar
              title="Activity"
              subtitle={
                entries.length
                  ? filtering
                    ? `${shown} of ${entries.length} entries match`
                    : `${entries.length} entries, newest first`
                  : undefined
              }
            />
            {p.offline ? <Notice tone="offline">Offline · showing your saved copy.</Notice> : null}
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
                <Button label="Import history" variant="text" icon="upload" onPress={() => router.push('/import')} style={{ alignSelf: 'flex-start' }} />
              </>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: colors.bg, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={styles.sectionLabel} accessibilityRole="header">
              {section.title} · {section.data.length}
            </Text>
          </View>
        )}
        renderItem={({ item, index, section }) => (
          <View style={{ marginHorizontal: 16, backgroundColor: colors.surface, borderColor: colors.line, borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: index === 0 ? 1 : 0, borderBottomWidth: index === section.data.length - 1 ? 1 : 0, borderTopLeftRadius: index === 0 ? 16 : 0, borderTopRightRadius: index === 0 ? 16 : 0, borderBottomLeftRadius: index === section.data.length - 1 ? 16 : 0, borderBottomRightRadius: index === section.data.length - 1 ? 16 : 0, overflow: 'hidden' }}>
            <ActivityRow
              entry={item}
              last={index === section.data.length - 1}
              onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: item.ticker } })}
            />
          </View>
        )}
        ListEmptyComponent={
          entries.length === 0 ? (
            <EmptyState
              icon="activity"
              title="Nothing recorded yet"
              body="Buys, sales, dividends and splits appear here, newest first."
              action={<Button label="Import history" icon="upload" onPress={() => router.push('/import')} />}
            />
          ) : (
            <EmptyState icon="activity" title="No entries match" body="Try a different search or filter." />
          )
        }
      />
    </SafeAreaView>
  );
}
