import { Text } from 'react-native';
import { router } from 'expo-router';
import { money, round } from '@shared/portfolio.ts';
import {
  accountActivity,
  consolidatedAccount,
} from '@shared/portfolio-account.ts';
import { usePortfolio } from '@/data/usePortfolio';
import { AppBar } from './AppBar';
import {
  Button,
  Card,
  Loading,
  Muted,
  Notice,
  Screen,
  SectionLabel,
  useKitStyles,
} from './kit';

export function ChoosePortfolio({ purpose }: { purpose: string }) {
  const p = usePortfolio();
  const styles = useKitStyles();
  return (
    <Screen>
      <Text style={styles.title}>Choose a portfolio</Text>
      <Muted>{purpose} Each portfolio has its own ledger and SIP plan.</Muted>
      {p.isLoading ? <Loading /> : null}
      {p.account?.portfolios.map((entry) => (
        <Button
          variant="outline"
          key={entry.id}
          label={entry.name}
          onPress={() => p.select(entry.id)}
        />
      ))}
      <Button
        variant="text"
        label="Create or manage portfolios"
        onPress={() => router.push('/portfolios')}
      />
    </Screen>
  );
}

export function AllPortfolios({
  mode = 'holdings',
}: {
  mode?: 'holdings' | 'activity' | 'notifications';
}) {
  const p = usePortfolio();
  const styles = useKitStyles();
  if (!p.account)
    return (
      <Screen>
        <AppBar title="All portfolios" />
        {p.error ? (
          <Notice tone="error">{p.error.message}</Notice>
        ) : (
          <Loading />
        )}
      </Screen>
    );
  const result = consolidatedAccount(p.account);
  const shown = (n: number | null) => (n === null ? 'Unknown' : money(n));
  const activity = mode === 'activity' ? accountActivity(p.account) : [];
  const notifications = p.account.portfolios.flatMap((e) =>
    (e.portfolio.notifications ?? [])
      .filter((n) => !n.clearedAt)
      .map((n) => ({ ...n, portfolioId: e.id, portfolioName: e.name })),
  );
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <AppBar
        title={
          mode === 'activity'
            ? 'All activity'
            : mode === 'notifications'
              ? 'All notifications'
              : 'All portfolios'
        }
      />
      {p.offline ? (
        <Notice tone="offline">
          Offline · saved portfolios are read-only.
        </Notice>
      ) : null}
      {result.summary.incomplete.length ? (
        <Notice>
          {result.summary.missingPrice.length
            ? `Missing prices: ${result.summary.missingPrice.join(', ')}. `
            : ''}
          {result.summary.unknownCost.length
            ? `Unknown costs: ${result.summary.unknownCost.join(', ')}.`
            : ''}
        </Notice>
      ) : null}
      {mode === 'holdings' ? (
        <>
          <Card>
            <Muted>
              {result.summary.missingPrice.length
                ? 'Priced market value · incomplete'
                : 'Combined market value'}
            </Muted>
            <Text style={styles.number}>{shown(result.summary.value)}</Text>
            <Muted>Remaining cost: {shown(result.summary.cost)}</Muted>
            <Muted>Unrealised gain / loss: {shown(result.summary.gain)}</Muted>
          </Card>
          <SectionLabel>Portfolios</SectionLabel>
          {result.breakdown.map((e) => (
            <Card key={e.id}>
              <Text style={styles.strong}>{e.name}</Text>
              <Muted>
                {e.summary.missingPrice.length
                  ? `${shown(e.summary.value)} priced · incomplete`
                  : shown(e.summary.value)}{' '}
                · {e.summary.heldCount} holdings
              </Muted>
              <Button
                label="Open portfolio"
                variant="text"
                onPress={() => p.select(e.id)}
              />
            </Card>
          ))}
          <Button
            label="Import into a portfolio"
            icon="upload"
            onPress={() => router.push('/import')}
          />
          <SectionLabel>Combined holdings</SectionLabel>
          {result.positions.map((h) => (
            <Card key={h.ticker}>
              <Text style={styles.strong}>
                {h.ticker} · {h.shares} shares
              </Text>
              <Muted>{h.name}</Muted>
              <Text style={styles.text}>
                Value: {shown(h.value)} · Cost: {shown(h.cost)}
              </Text>
              <Muted>
                Gain: {shown(h.gain)} · Weight:{' '}
                {h.value === null ||
                result.summary.missingPrice.length > 0 ||
                !result.summary.value
                  ? 'Unknown'
                  : `${round((h.value / result.summary.value) * 100)}%`}
              </Muted>
              {h.portfolios.map((entry) => (
                <Button
                  key={entry.id}
                  variant="text"
                  label={`${entry.name}: ${entry.shares} shares · ${shown(entry.value)}`}
                  onPress={() => {
                    p.select(entry.id);
                    router.push(`/company/${h.ticker}`);
                  }}
                />
              ))}
            </Card>
          ))}
          <SectionLabel>Combined reports</SectionLabel>
          <Card>
            <Text style={styles.text}>
              Received dividends · gross: {shown(result.tax.receivedDividends)}
            </Text>
            <Text style={styles.text}>
              Realised gain / loss
              {result.tax.unknownSaleCosts ? ' · known costs only' : ''}:{' '}
              {shown(result.tax.realizedGain)}
            </Text>
            <Text style={styles.text}>
              Net realised return: {shown(result.tax.netRealizedReturn)}
            </Text>
            <Muted>
              Capital gains tax: {shown(result.tax.capitalGainsTax)} · Dividend
              tax: {shown(result.tax.dividendTax)}
            </Muted>
            <Muted>
              Tax totals sum each portfolio’s recorded deductions and estimates.{' '}
              {result.tax.expectedDividends} expected dividends are excluded
              from received income.
            </Muted>
          </Card>
          <Button
            label="Choose a portfolio for SIP and Monthly Picks"
            variant="outline"
            onPress={() => router.push('/plan')}
          />
        </>
      ) : null}
      {mode === 'activity'
        ? activity.map((e) => (
            <Card key={`${e.portfolioId}:${e.kind}:${e.id}`}>
              <Text style={styles.strong}>
                {e.ticker} · {e.kind}
                {e.voided ? ' · voided' : ''}
              </Text>
              <Muted>
                {e.date} · {e.note}
              </Muted>
              <Button
                variant="text"
                label={e.portfolioName}
                onPress={() => {
                  p.select(e.portfolioId);
                  router.push('/activity');
                }}
              />
            </Card>
          ))
        : null}
      {mode === 'notifications'
        ? notifications.map((n) => (
            <Card key={`${n.portfolioId}:${n.id}`}>
              <Text style={styles.strong}>{n.title}</Text>
              <Muted>{n.body}</Muted>
              <Button
                variant="text"
                label={`Open ${n.portfolioName} inbox`}
                onPress={() => {
                  p.select(n.portfolioId);
                  router.push('/inbox');
                }}
              />
            </Card>
          ))
        : null}
    </Screen>
  );
}
