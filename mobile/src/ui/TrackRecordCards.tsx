import { useState } from 'react';
import { Text, View } from 'react-native';
import { today } from '@shared/portfolio.ts';
import { benchmarkView, returnView, TRACK_RANGES, valueChartView, type TrackRange } from '@/data/track-record';
import { useTrackRecord } from '@/data/useTrackRecord';
import { useTheme } from '@/theme/ThemeProvider';
import { MultiLineChart } from './LineChart';
import { Card, Collapsible, Muted, Notice, Segmented, Stat, useKitStyles } from './kit';

const thisYear = () => Number(today().slice(0, 4));

function Legend({ items }: { items: { color: string; text: string; dashed?: boolean }[] }) {
  const styles = useKitStyles();
  return (
    <View style={{ gap: 4 }}>
      {items.map((i) => (
        <View key={i.text} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 24, height: 0, borderTopWidth: 2.5, borderColor: i.color, borderStyle: i.dashed ? 'dashed' : 'solid' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={[styles.muted, { flexShrink: 1 }]}>{i.text}</Text>
        </View>
      ))}
    </View>
  );
}

function RangeControl({ value, onChange }: { value: TrackRange; onChange: (r: TrackRange) => void }) {
  return <Segmented label="Chart range" value={value} onChange={onChange} options={TRACK_RANGES.map((r) => ({ key: r.key, label: r.label, spoken: `${r.spoken} range` }))} />;
}

function Pending({ status, retry }: { status: 'loading' | 'error'; retry: () => void }) {
  if (status === 'error')
    return <Notice tone="error" action={{ label: 'Try again', onPress: retry }}>Could not load price history. Your saved numbers above are unaffected.</Notice>;
  return <Muted>Loading price history…</Muted>;
}

/** Value against money put in, with a range control and a plain-language summary. Used on Today (collapsed) and Insights. */
export function ValueVsMoneyInCard({ collapsible = false }: { collapsible?: boolean }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [range, setRange] = useState<TrackRange>('1y');
  const t = useTrackRecord();
  if (t.status === 'empty') return null;
  const view = t.record ? valueChartView(t.record.value, range, thisYear()) : null;
  const body = (
    <>
      {!view ? <Pending status={t.status === 'error' ? 'error' : 'loading'} retry={t.retry} /> : null}
      {view?.kind === 'empty' ? <Muted>{view.reason}</Muted> : null}
      {view?.kind === 'chart' ? (
        <>
          <Text style={styles.text}>{view.summary}</Text>
          <MultiLineChart
            label={view.spoken}
            series={[
              { points: view.value, color: colors.primary, width: 2.5 },
              { points: view.moneyIn, color: colors.muted, dashed: true },
            ]}
          />
          <Legend items={[{ color: colors.primary, text: 'Market value of holdings' }, { color: colors.muted, text: 'Money in (buys + fees − sale proceeds)', dashed: true }]} />
          <RangeControl value={range} onChange={setRange} />
          {view.notes.map((n) => (
            <Notice key={n} tone="warn">{n}</Notice>
          ))}
          <Muted>How this is calculated: value is shares held each day × that day’s PSX close. Money in adds buys and fees and subtracts sale proceeds after fees. Dividends and tax withheld are not included, so the gap is not your total return.</Muted>
        </>
      ) : null}
    </>
  );
  if (collapsible) return <Collapsible title="Value vs money in">{body}</Collapsible>;
  return (
    <Card>
      <Text style={styles.sectionLabel}>Value vs money in</Text>
      {body}
    </Card>
  );
}

/** Money-weighted return (XIRR) with its method note. */
export function MoneyWeightedReturnCard() {
  const styles = useKitStyles();
  const t = useTrackRecord();
  if (t.status === 'empty') return null;
  const r = t.record ? returnView(t.record.mwr, t.record.block) : null;
  return (
    <Collapsible title="Money-weighted return" defaultOpen>
      {!r ? <Pending status={t.status === 'error' ? 'error' : 'loading'} retry={t.retry} /> : null}
      {r?.headline ? (
        <Stat label="Money-weighted return">
          <Text style={styles.number} accessibilityLabel={`Money-weighted return, ${r.spoken}`}>{r.headline}</Text>
        </Stat>
      ) : null}
      {r && !r.headline ? <Muted>{r.note}</Muted> : null}
      <Muted>
        How this is calculated: the yearly rate (XIRR) at which every date you added or took out money, plus today’s market value as the final amount, balances to zero. It rewards good timing of your own deposits. It excludes dividends, and needs at least 90 days of history and a price and cost for every holding.
      </Muted>
    </Collapsible>
  );
}

/** "Compare with KSE-100": the same cash flows invested in the index on the same dates. */
export function BenchmarkCard() {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [range, setRange] = useState<TrackRange>('all');
  const t = useTrackRecord();
  if (t.status === 'empty') return null;
  const view = t.record ? benchmarkView(t.record.benchmark, range, thisYear(), t.record.benchmarkBlock) : null;
  return (
    <Collapsible title="Compare with KSE-100">
      {!view ? <Pending status={t.status === 'error' ? 'error' : 'loading'} retry={t.retry} /> : null}
      {view?.kind === 'unavailable' ? <Muted>{view.reason}</Muted> : null}
      {view?.kind === 'chart' ? (
        <>
          <Text style={styles.text}>{view.summary}</Text>
          <MultiLineChart
            label={view.spoken}
            series={[
              { points: view.portfolio, color: colors.primary, width: 2.5 },
              { points: view.benchmark, color: colors.muted, dashed: true },
            ]}
          />
          <Legend items={[{ color: colors.primary, text: 'Your portfolio' }, { color: colors.muted, text: view.legend, dashed: true }]} />
          <RangeControl value={range} onChange={setRange} />
          <View style={styles.row}>
            <Stat label="Your return">
              <Text style={styles.number}>{view.yours.headline ?? '—'}</Text>
            </Stat>
            <Stat label="KSE-100, same flows">
              <Text style={styles.number}>{view.index.headline ?? '—'}</Text>
            </Stat>
          </View>
          {!view.yours.headline && view.yours.note ? <Muted>{view.yours.note}</Muted> : null}
          {view.notes.map((n) => (
            <Notice key={n} tone="warn">{n}</Notice>
          ))}
          <Muted>
            How this is calculated: each time you added or took out money, the same amount goes into or out of the KSE-100 price index at the nearest close on or before that date. Returns are yearly money-weighted rates (XIRR) over the same dates. The index is a price index: dividends are not included, while your own dividends are not either, so the comparison is price against price. Differences also come from which companies you hold, fees and the timing of your deposits.
          </Muted>
        </>
      ) : null}
    </Collapsible>
  );
}
