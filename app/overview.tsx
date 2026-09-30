'use client';
import { useState, type RefObject } from 'react';
import { ChevronDown, CircleAlert, Clock, Coins, Plus, Tag } from 'lucide-react';
import { Tagline } from './brand';
import { HoldingsTable } from './holdings-table';
import type { usePortfolioSummary } from './hooks/use-portfolio-summary';
import PortfolioHistory, { PortfolioMetrics } from './portfolio-value-card';
import { usePortfolioContext } from './portfolio-context';
import PsxMarketPulse, { type PsxMarketPulseHandle } from './psx-market-pulse';

type Summary = ReturnType<typeof usePortfolioSummary>;

type Notice = {
  key: string;
  icon: typeof CircleAlert;
  text: string;
  action: string;
  onAction: () => void;
};

/** Only issues the user can act on, each with the action that resolves it. */
function DataQuality({ summary }: { summary: Summary }) {
  const { refreshPrices, openCompany, goTab, busy } = usePortfolioContext();
  const notices: Notice[] = [];
  const { missing, unknown, stale, expectedDividends } = summary;
  if (missing.length)
    notices.push({
      key: 'missing',
      icon: Tag,
      text: `${missing.length} ${missing.length === 1 ? 'holding has' : 'holdings have'} no price (${missing.map((h) => h.ticker).join(', ')}). Value and gain are incomplete.`,
      action: 'Refresh prices',
      onAction: () => void refreshPrices(),
    });
  if (unknown.length)
    notices.push({
      key: 'unknown',
      icon: CircleAlert,
      text: `${unknown.length} ${unknown.length === 1 ? 'holding has' : 'holdings have'} an unknown cost (${unknown.map((h) => h.ticker).join(', ')}). Gain and tax figures cannot be calculated for them.`,
      action: `Fix ${unknown[0].ticker}`,
      onAction: () => openCompany(unknown[0].ticker),
    });
  if (stale.length)
    notices.push({
      key: 'stale',
      icon: Clock,
      text: `${stale.length} ${stale.length === 1 ? 'price is' : 'prices are'} older than the last trading session (${stale.map((h) => h.ticker).join(', ')}).`,
      action: 'Refresh prices',
      onAction: () => void refreshPrices(),
    });
  if (expectedDividends.length)
    notices.push({
      key: 'dividends',
      icon: Coins,
      text: `${expectedDividends.length} expected ${expectedDividends.length === 1 ? 'dividend is' : 'dividends are'} waiting for you to confirm receipt. They are not counted as income until then.`,
      action: 'Review in Activity',
      onAction: () => goTab('history'),
    });
  if (!notices.length) return null;
  return (
    <section aria-label="Data quality" className="dq">
      <h2 className="sr-only">Needs your attention</h2>
      <ul className="dq-list">
        {notices.map((n) => (
          <li key={n.key} className="dq-item">
            <n.icon size={18} aria-hidden="true" />
            <span>{n.text}</span>
            <button type="button" className="secondary compact" disabled={busy} onClick={n.onAction}>
              {n.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MarketPulseSection({
  pulseRef,
  onOpenShortlist,
}: {
  pulseRef: RefObject<PsxMarketPulseHandle | null>;
  onOpenShortlist: () => void;
}) {
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  return (
    <section className="pulse-section" aria-label="Market Pulse">
      <button
        type="button"
        data-slot="link"
        className="pulse-toggle"
        aria-expanded={open}
        aria-controls="market-pulse-body"
        onClick={() => setOpen((v) => !v)}
      >
        <h2>Market Pulse</h2>
        <span>
          {open ? 'Hide' : 'Show'}
          <ChevronDown size={16} aria-hidden="true" className={open ? 'flip' : undefined} />
        </span>
      </button>
      {/* Stays mounted while collapsed so "Refresh PSX prices" can still refresh it. */}
      <div id="market-pulse-body" hidden={!open}>
        <PsxMarketPulse ref={pulseRef} onOpenShortlist={onOpenShortlist} />
      </div>
    </section>
  );
}

export function Overview({
  summary,
  pulseRef,
}: {
  summary: Summary;
  pulseRef: RefObject<PsxMarketPulseHandle | null>;
}) {
  const { p, busy, openDialog, goTab } = usePortfolioContext();
  const { held, missing, unknown, value, cost, gain, newBuys, soldOut, sectorsInUse, stale } = summary;
  const staleTickers = new Set(stale.map((h) => h.ticker));
  return (
    <>
      <section className="overview-intro">
        <h1>Your portfolio</h1>
        <Tagline />
      </section>
      <PortfolioMetrics
        value={value}
        cost={cost}
        gain={gain}
        heldCount={held.length}
        missingCount={missing.length}
        unknownCount={unknown.length}
        newBuys={newBuys}
      />
      <DataQuality summary={summary} />
      <div className="section-top">
        <div>
          <h2>Your holdings</h2>
          <p>
            {held.length} {held.length === 1 ? 'holding' : 'holdings'}
            {soldOut.length ? ` · ${soldOut.length} fully sold` : ''}
          </p>
        </div>
        <button type="button" className="secondary" disabled={busy} onClick={() => openDialog({ type: 'company' })}>
          <Plus size={16} aria-hidden="true" /> Add company
        </button>
      </div>
      <HoldingsTable
        rows={held}
        soldOut={soldOut}
        sectors={sectorsInUse}
        totalValue={value}
        pricesComplete={missing.length === 0}
        staleTickers={staleTickers}
        hasAnyTrades={p.trades.some((t) => !t.voided)}
      />
      <PortfolioHistory p={p} value={value} cost={cost} gain={gain} missingCount={missing.length} />
      <MarketPulseSection pulseRef={pulseRef} onOpenShortlist={() => goTab('sip')} />
    </>
  );
}
