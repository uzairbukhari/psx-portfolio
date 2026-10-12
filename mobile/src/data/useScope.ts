import { useMemo } from 'react';
import { accountOverview } from '@shared/account-overview.ts';
import { today } from '@shared/portfolio.ts';
import { useFundNavs } from './useFundNavs';
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
  const metal = useMetalRates(metals.length > 0);
  const fundNavs = useFundNavs(funds.length > 0);
  const hasAssets = assets.length > 0;
  const overview = useMemo(() => {
    if (!parts.length) return null;
    try {
      return accountOverview(parts, today(), { metalRates: metal.rates, fundNavs: fundNavs.navs });
    } catch {
      return null; // a ledger that cannot be valued is reported by the screen's own error notice
    }
  }, [parts, metal.rates, fundNavs.navs]);
  return { parts, assets, metals, plans, funds, metal, fundNavs, hasAssets, overview };
}
