'use client';

import { useMemo, useState } from 'react';
import { DatabaseZap, Loader2, Search, Sparkles } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { money, today, type Company, type Portfolio } from '@/lib/portfolio';
import { portfolioCounts } from '@/lib/portfolio-counts';
import type { FactsInfo } from './use-recommendations';

export const MAX_SHORTLIST = 15;

type Props = {
  portfolio: Portfolio;
  month: string;
  setMonth: (month: string) => void;
  amount: number;
  setAmount: (amount: number) => void;
  feePct: number;
  setFeePct: (fee: number) => void;
  shortlist: string[];
  setShortlist: (next: string[]) => void;
  facts: Record<string, FactsInfo | undefined>;
  dispatchEnabled: boolean;
  running: boolean;
  refreshing: boolean;
  busy: boolean;
  rerun: boolean;
  onGenerate: () => void;
  onRefreshFacts: (tickers: string[]) => void;
  collapsed: boolean;
  onExpand: () => void;
  onOpenCompany: (ticker: string) => void;
};

function freshness(info: FactsInfo | undefined, dispatchEnabled: boolean) {
  if (!info || info.state === 'missing')
    return { state: 'missing', label: 'No data yet', hint: dispatchEnabled ? 'Fetched from PSX when you generate.' : 'Not scraped yet — the daily PSX scrape runs after the close (17:00 PKT).' };
  if (info.state === 'failed') return { state: 'failed', label: 'Fetch failed', hint: info.error ?? 'The last PSX fetch failed.' };
  if (info.state === 'stale') return { state: 'stale', label: `${info.ageDays}d old`, hint: `Company data from ${info.fetchedOn} is older than a week.` };
  return { state: 'fresh', label: info.ageDays ? `${info.ageDays}d old` : 'Today', hint: `Company data from ${info.fetchedOn}.` };
}

export default function PicksSetup(props: Props) {
  const { portfolio, shortlist, setShortlist, facts, dispatchEnabled } = props;
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return portfolio.companies.filter(
      (company) => !needle || company.ticker.toLowerCase().includes(needle) || company.name.toLowerCase().includes(needle),
    );
  }, [portfolio.companies, query]);

  const targeted = useMemo(
    () => portfolio.companies.filter((company: Company) => company.target > 0).map((company) => company.ticker).slice(0, MAX_SHORTLIST),
    [portfolio.companies],
  );
  const notFresh = shortlist.filter((ticker) => facts[ticker]?.state !== 'fresh');
  const noData = notFresh.filter((ticker) => !facts[ticker] || facts[ticker]!.state === 'missing' || facts[ticker]!.state === 'failed');

  function toggle(ticker: string) {
    if (shortlist.includes(ticker)) setShortlist(shortlist.filter((item) => item !== ticker));
    else if (shortlist.length < MAX_SHORTLIST) setShortlist([...shortlist, ticker]);
  }

  const amountValid = Number.isFinite(props.amount) && props.amount > 0 && props.amount <= 1e9;
  const disabledReason = props.running ? 'A run is already in progress.'
    : !shortlist.length ? 'Choose at least one company.'
    : !amountValid ? 'Enter an amount between 1 and 1,000,000,000.'
    : '';

  const generateButton = (
    <button type="button" className="mp-generate" disabled={props.busy || !!disabledReason} onClick={props.onGenerate}>
      {props.running ? <Loader2 className="spin" size={17} /> : <Sparkles size={17} />}
      {props.running ? 'Working…' : props.rerun ? 'Re-run picks' : 'Generate picks'}
    </button>
  );

  const steps: [string, string][] = [
    ['Choose', `Up to ${MAX_SHORTLIST} PSX companies you would be happy to own, plus this month's money.`],
    ['Score', 'Each company gets 0–100 from public PSX data: earnings yield, profit growth, margins and 52-week position.'],
    ['Split', 'Top scorers share your money. Max 35% per pick and 20% of your portfolio per holding. Leftovers stay cash; nothing is sold.'],
    ['Review', 'You get whole-share estimates at the latest price. Nothing is recorded until you record the buys yourself.'],
  ];
  const howTo = (
    <details className="mp-howto">
      <summary>How Monthly Picks works <span className="mp-beta">Experimental</span></summary>
      <ol className="mp-howto__steps">
        {steps.map(([title, text], index) => (
          <li key={title}>
            <span className="mp-howto__num" aria-hidden="true">{index + 1}</span>
            <b>{title}</b>
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <p className="muted mp-howto__note">It looks only at the companies you choose, not what you hold, and runs on your device, so your holdings and amounts never leave it. A screening aid, not investment advice.</p>
    </details>
  );

  if (props.collapsed) {
    return (
      <>
      <section className="mp-setup mp-setup--collapsed">
        <div className="mp-setup__summary">
          <b>{props.month}</b>
          <span>{money(props.amount)}</span>
          <span>{props.feePct}% fees</span>
          <span>{shortlist.length} {shortlist.length === 1 ? 'company' : 'companies'}</span>
          {!!notFresh.length && <span className="mp-hint mp-hint--warn">{notFresh.length} need fresh data</span>}
        </div>
        <div className="mp-actionbar__buttons">
          <button type="button" className="secondary compact" onClick={props.onExpand}>Edit inputs</button>
          {generateButton}
        </div>
      </section>
      <section className="mp-setup mp-howto-wrap">{howTo}</section>
      </>
    );
  }

  return (
    <section className="mp-setup">
      <div className="mp-setup__bar">
        <div className="mp-setup__intro">
          <p className="eyebrow">MONTHLY PICKS</p>
          <h2>Where should this month&apos;s money go?</h2>
          <p>Choose companies and an amount. PSX company data is scored, then ranked for the next 60–90 days.</p>
        </div>
        <div className="mp-fields">
          <label>
            Contribution month
            <input
              type="month"
              value={props.month}
              onChange={(event) => {
                const next = event.target.value || today().slice(0, 7);
                props.setMonth(next);
                props.setAmount(portfolio.budgets[next] ?? 100000);
              }}
            />
          </label>
          <label>
            Fresh money (PKR)
            <input
              type="number" inputMode="numeric" min="1" max="1000000000" step="1"
              value={Number.isFinite(props.amount) ? props.amount : ''}
              onChange={(event) => props.setAmount(Number(event.target.value))}
              aria-invalid={!amountValid}
            />
            <small>{amountValid ? money(props.amount) : 'Invalid amount'}</small>
          </label>
          <label>
            Est. fees (%)
            <input
              type="number" inputMode="decimal" min="0" max="10" step="0.01"
              value={Number.isFinite(props.feePct) ? props.feePct : ''}
              onChange={(event) => props.setFeePct(Number(event.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="mp-howto-wrap">{howTo}</div>

      <div className="mp-shortlist">
        <div className="mp-shortlist__top">
          <div>
            <h3>Shortlist <span className="mp-count">{shortlist.length}/{MAX_SHORTLIST}</span></h3>
            <p className="muted">Tick to include a company; click a card to open its page.</p>
            <p className="muted" aria-label="Counts">
              {(() => {
                const c = portfolioCounts(portfolio, shortlist);
                return `${c.savedCompanies} saved · ${c.holdings} held · ${c.shortlisted} shortlisted`;
              })()}
            </p>
          </div>
          <div className="mp-shortlist__tools">
            {!!targeted.length && <button type="button" className="link-button" onClick={() => setShortlist(targeted)}>Target holdings</button>}
            <button type="button" className="link-button" onClick={() => setShortlist(portfolio.companies.slice(0, MAX_SHORTLIST).map((company) => company.ticker))}>First {MAX_SHORTLIST}</button>
            <button type="button" className="link-button" disabled={!shortlist.length} onClick={() => setShortlist([])}>Clear</button>
            <label className="mp-search">
              <Search size={15} />
              <input aria-label="Search companies" placeholder="Search name or ticker" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          </div>
        </div>

        <div className="mp-picker">
          {filtered.map((company) => {
            const selected = shortlist.includes(company.ticker);
            const fresh = freshness(facts[company.ticker], dispatchEnabled);
            const blocked = !selected && shortlist.length >= MAX_SHORTLIST;
            return (
              <div key={company.ticker} className={`mp-option${selected ? ' selected' : ''}${blocked ? ' blocked' : ''}`}>
                <Checkbox
                  aria-label={`${selected ? 'Remove' : 'Add'} ${company.ticker} ${selected ? 'from' : 'to'} shortlist`}
                  checked={selected} disabled={blocked} onCheckedChange={() => toggle(company.ticker)}
                />
                <a
                  className="mp-option__open"
                  href={`/company/${company.ticker}`}
                  title={`Open ${company.name}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    props.onOpenCompany(company.ticker);
                  }}
                >
                  <span className="mp-option__text">
                    <b>{company.ticker}</b>
                    <small title={company.name}>{company.name}</small>
                  </span>
                  <span className={`mp-fresh mp-fresh--${fresh.state}`} title={fresh.hint}>{fresh.label}</span>
                </a>
              </div>
            );
          })}
        </div>
        {!filtered.length && <p className="muted">No company matches that search.</p>}
      </div>

      <div className="mp-actionbar">
        <div className="mp-actionbar__info">
          {!!notFresh.length && (
            <p className="mp-hint">
              {dispatchEnabled
                ? `${notFresh.length} selected ${notFresh.length === 1 ? 'company needs' : 'companies need'} fresh PSX data — generating fetches ${notFresh.length === 1 ? 'it' : 'them'} first (about 1–2 min).`
                : noData.length
                  ? `${noData.length} selected ${noData.length === 1 ? 'company has' : 'companies have'} no PSX data yet and will be skipped until the next daily scrape.`
                  : 'Some selected data is over a week old; scores may lag the latest results.'}
            </p>
          )}
          {disabledReason && <p className="mp-hint mp-hint--warn">{disabledReason}</p>}
          {!notFresh.length && !disabledReason && <p className="mp-hint">Data is current. Only the company symbols are sent to fetch public data; your amount, holdings and result stay on this device.</p>}
        </div>
        <div className="mp-actionbar__buttons">
          {dispatchEnabled && !!notFresh.length && (
            <button type="button" className="secondary compact" disabled={props.refreshing || props.running} onClick={() => props.onRefreshFacts(notFresh)}>
              {props.refreshing ? <Loader2 className="spin" size={15} /> : <DatabaseZap size={15} />}
              {props.refreshing ? 'Fetching…' : 'Fetch data now'}
            </button>
          )}
          {generateButton}
        </div>
      </div>
    </section>
  );
}
