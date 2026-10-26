// The account_snapshot usage event: how big an account is, in fixed buckets, never how much is in it. Computed on the
// device from the decrypted account; only the buckets leave it. Pure module.
import { ledgerAgeBucket, portfoliosBucket, positionsBucket } from './analytics-events.ts';
import { holdings } from './portfolio.ts';
import type { PortfolioAccount } from './portfolio-account.ts';

export function accountSnapshot(account: PortfolioAccount, today: string) {
  const parts = account.portfolios.map((x) => x.portfolio);
  const tickers = new Set<string>();
  for (const p of parts) for (const h of holdings(p)) if (h.shares > 0) tickers.add(h.ticker);
  const otherAssets = parts.some((p) => (p.assets ?? []).length > 0);
  const dates = parts.flatMap((p) => p.trades.map((t) => t.date)).filter(Boolean).sort();
  return {
    positions: positionsBucket(tickers.size),
    portfolios: portfoliosBucket(parts.length),
    classes: tickers.size && otherAssets ? 'multi' : tickers.size ? 'stocks' : otherAssets ? 'other' : 'none',
    ledger_age: ledgerAgeBucket(dates[0] ?? null, today),
  };
}
