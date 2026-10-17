import { useMemo } from 'react';
import { accountOverview } from '@shared/account-overview.ts';
import { today } from '@shared/portfolio.ts';
import { useFundNavs } from './useFundNavs';
import { useFxRates } from './useFxRates';
import { useMetalRates } from './useMetalRates';
import { usePortfolio } from './usePortfolio';

/**
 * What the selected portfolio (or all of them) holds beyond stocks, valued the way the All dashboard values it.
 * Gold, silver, savings plans and funds are part of a portfolio, so every screen that summarises one reads from here
 * instead of looking at stock trades only.
 */
export function useScope() {
  const p = usePortfolio();
  const parts = useMemo(() => (p.account ? (p.isAll ? p.account.portfolios : p.account.portfolios.filter((e) => e.id === p.targetId)) : []), [p.account, p.isAll, p.targetId]);
  const labelled = parts.length > 1;
  const assets = useMemo(() => parts.flatMap((part) => (part.portfolio.assets ?? []).map((asset) => ({ asset, portfolioName: labelled ? part.name : undefined }))), [parts, labelled]);
  const metals = useMemo(() => assets.flatMap((o) => (o.asset.kind === 'metal' ? [{ ...o, asset: o.asset }] : [])), [assets]);
  const plans = useMemo(() => assets.flatMap((o) => (o.asset.kind === 'plan' ? [{ ...o, asset: o.asset }] : [])), [assets]);
  const funds = useMemo(() => assets.flatMap((o) => (o.asset.kind === 'fund' ? [{ ...o, asset: o.asset }] : [])), [assets]);
  const currencies = useMemo(() => assets.flatMap((o) => (o.asset.kind === 'currency' ? [{ ...o, asset: o.asset }] : [])), [assets]);
  const metal = useMetalRates(metals.length > 0);
  const fx = useFxRates(currencies.length > 0);
  const fundNavs = useFundNavs(funds.length > 0);
  const hasAssets = assets.length > 0;
  const overview = useMemo(() => {
    if (!parts.length) return null;
    try {
      return accountOverview(parts, today(), { metalRates: metal.rates, fundNavs: fundNavs.navs, fxRates: fx.rates });
    } catch {
      return null; // a ledger that cannot be valued is reported by the screen's own error notice
    }
  }, [parts, metal.rates, fundNavs.navs, fx.rates]);
  return { parts, assets, metals, plans, funds, currencies, metal, fundNavs, fx, hasAssets, overview };
}

/** Value and share of net worth for every portfolio, whatever is selected. Computed only while `enabled` (the chooser is open). */
export function usePortfolioTotals(enabled: boolean) {
  const p = usePortfolio();
  const parts = useMemo(() => (enabled && p.account ? p.account.portfolios : []), [enabled, p.account]);
  const hasMetals = parts.some((e) => (e.portfolio.assets ?? []).some((a) => a.kind === 'metal'));
  const hasFunds = parts.some((e) => (e.portfolio.assets ?? []).some((a) => a.kind === 'fund'));
  const hasCurrency = parts.some((e) => (e.portfolio.assets ?? []).some((a) => a.kind === 'currency'));
  const metal = useMetalRates(enabled && hasMetals);
  const fundNavs = useFundNavs(enabled && hasFunds);
  const fx = useFxRates(enabled && hasCurrency);
  return useMemo(() => {
    if (!parts.length) return null;
    try {
      return accountOverview(parts, today(), { metalRates: metal.rates, fundNavs: fundNavs.navs, fxRates: fx.rates });
    } catch {
      return null;
    }
  }, [parts, metal.rates, fundNavs.navs, fx.rates]);
}
