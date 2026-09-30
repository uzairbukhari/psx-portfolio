'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, MoreHorizontal, Plus, Search, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { pct, pkr, shares as fmtShares } from '@/lib/format';
import { today } from '@/lib/portfolio';
import { GainText } from './gain-text';
import type { Holding } from './hooks/use-portfolio-summary';
import { ImportButtons } from './import-actions';
import { usePortfolioContext } from './portfolio-context';

type SortKey = 'name' | 'shares' | 'average' | 'price' | 'value' | 'gain' | 'weight';
const COLUMNS: [SortKey, string, boolean][] = [
  ['name', 'Company', false],
  ['shares', 'Shares', true],
  ['average', 'Avg. cost', true],
  ['price', 'Latest price', true],
  ['value', 'Market value', true],
  ['gain', 'Gain / loss', true],
  ['weight', 'Portfolio weight', true],
];

function PriceFreshness({ holding, stale }: { holding: Holding; stale: boolean }) {
  const q = holding.quote;
  if (!q) return <small className="freshness warn">No price yet</small>;
  return (
    <small className={'freshness' + (stale ? ' warn' : '')}>
      {stale && <TriangleAlert size={12} aria-hidden="true" />}
      {q.date === today() ? 'Today' : q.date}
      {q.manual ? ' · manual' : ''}
      {stale ? ' · stale' : q.date !== today() ? ' · older quote' : ''}
    </small>
  );
}

/** One shared action list, used by both the desktop row menu and the mobile card. */
function useRowActions() {
  const { openDialog, openCompany } = usePortfolioContext();
  return {
    view: (h: Holding) => openCompany(h.ticker),
    sell: (h: Holding) =>
      openDialog({ type: 'trade', ticker: h.ticker, kind: 'sell' }),
    buy: (h: Holding) =>
      openDialog({ type: 'trade', ticker: h.ticker, kind: 'buy' }),
    dividend: (h: Holding) => openDialog({ type: 'dividend', ticker: h.ticker }),
    edit: (h: Holding) => openDialog({ type: 'company', ticker: h.ticker }),
    price: (h: Holding) => openDialog({ type: 'quote', ticker: h.ticker }),
  };
}

function HoldingCard({
  h,
  weight,
  stale,
}: {
  h: Holding;
  weight: number | null;
  stale: boolean;
}) {
  const [open, setOpen] = useState(false);
  const actions = useRowActions();
  const { busy } = usePortfolioContext();
  const detailsId = `holding-${h.ticker}-details`;
  return (
    <li className="holding-card">
      <div className="holding-card-head">
        <button type="button" className="quote-btn ticker" onClick={() => actions.view(h)}>
          {h.ticker}
        </button>
        <span className="holding-card-name">{h.name}</span>
      </div>
      <dl className="holding-card-stats">
        <div>
          <dt>Shares</dt>
          <dd>{fmtShares(h.shares)}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{h.value === null ? '—' : pkr(h.value)}</dd>
        </div>
        <div>
          <dt>Gain / loss</dt>
          <dd>
            <GainText value={h.gain} />
          </dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>
            {h.quote ? pkr(h.quote.price) : 'Add price'}
            <PriceFreshness holding={h} stale={stale} />
          </dd>
        </div>
      </dl>
      <button
        type="button"
        className="holding-card-toggle"
        data-slot="link"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide details' : 'Details and actions'}
        <ChevronDown size={14} aria-hidden="true" className={open ? 'flip' : undefined} />
      </button>
      {open && (
        <div id={detailsId} className="holding-card-details">
          <dl className="holding-card-stats">
            <div>
              <dt>Avg. cost</dt>
              <dd>{h.average === null ? 'Unknown' : pkr(h.average)}</dd>
            </div>
            <div>
              <dt>Weight</dt>
              <dd>{weight === null ? '—' : pct(weight)}</dd>
            </div>
            <div>
              <dt>Sector</dt>
              <dd>{h.sector || '—'}</dd>
            </div>
          </dl>
          <div className="row">
            <button type="button" className="secondary compact" onClick={() => actions.view(h)}>
              View company
            </button>
            {h.shares > 0 && (
              <button type="button" className="secondary compact" disabled={busy} onClick={() => actions.sell(h)}>
                Sell
              </button>
            )}
            {h.shares > 0 && (
              <button type="button" className="secondary compact" disabled={busy} onClick={() => actions.dividend(h)}>
                Dividend
              </button>
            )}
            <button type="button" className="secondary compact" disabled={busy} onClick={() => actions.price(h)}>
              Set price
            </button>
            <button type="button" className="secondary compact" disabled={busy} onClick={() => actions.edit(h)}>
              Edit
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function HoldingsTable({
  rows,
  soldOut,
  sectors,
  totalValue,
  pricesComplete,
  staleTickers,
  hasAnyTrades,
}: {
  /** Companies currently held. */
  rows: Holding[];
  soldOut: Holding[];
  sectors: string[];
  totalValue: number;
  pricesComplete: boolean;
  staleTickers: Set<string>;
  hasAnyTrades: boolean;
}) {
  const { busy, openDialog } = usePortfolioContext();
  const actions = useRowActions();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState('');
  const [showSoldOut, setShowSoldOut] = useState(false);

  const weightOf = (h: Holding) =>
    pricesComplete && totalValue > 0 ? ((h.value ?? 0) / totalValue) * 100 : null;

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = showSoldOut ? rows.concat(soldOut) : rows;
    const filtered = base.filter(
      (h) =>
        (!sector || h.sector === sector) &&
        (!q || h.ticker.toLowerCase().includes(q) || h.name.toLowerCase().includes(q)),
    );
    if (!sort) return filtered;
    const accessor: Record<SortKey, (h: Holding) => number | string> = {
      name: (h) => h.name || h.ticker,
      shares: (h) => h.shares,
      average: (h) => h.average ?? -Infinity,
      price: (h) => h.quote?.price ?? -Infinity,
      value: (h) => h.value ?? -Infinity,
      gain: (h) => h.gain ?? -Infinity,
      weight: (h) => (totalValue > 0 ? (h.value ?? 0) / totalValue : -Infinity),
    };
    const get = accessor[sort.key];
    return filtered.slice().sort((a, b) => {
      const av = get(a),
        bv = get(b),
        cmp =
          typeof av === 'string'
            ? av.localeCompare(bv as string)
            : (av as number) - (bv as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, soldOut, showSoldOut, query, sector, sort, totalValue]);

  const filtering = !!query.trim() || !!sector;
  function reset() {
    setQuery('');
    setSector('');
    setShowSoldOut(false);
  }
  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev && prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
  }
  const ariaSort = (key: SortKey) =>
    sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';

  if (!hasAnyTrades && rows.length === 0 && soldOut.length === 0) {
    return (
      <section className="panel empty-state" aria-labelledby="holdings-empty-title">
        <h3 id="holdings-empty-title">No holdings yet</h3>
        <p>
          Record your first purchase, or bring in your history from a CDC
          statement or broker file. Your holdings, cost and gain appear here.
        </p>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => openDialog({ type: 'trade', kind: 'buy' })}>
            <Plus size={16} aria-hidden="true" /> Add first purchase
          </button>
          <ImportButtons />
        </div>
      </section>
    );
  }

  return (
    <>
      <search className="holdings-toolbar">
        <label className="holdings-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search holdings by symbol or company</span>
          <input
            type="search"
            placeholder="Search symbol or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="holdings-toolbar-filter">
          Sector
          <select value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {soldOut.length > 0 && (
          <label className="check-row">
            <Checkbox checked={showSoldOut} onCheckedChange={(v) => setShowSoldOut(!!v)} />
            Show companies fully sold ({soldOut.length})
          </label>
        )}
        {(filtering || showSoldOut) && (
          <button type="button" data-slot="link" className="link-button" onClick={reset}>
            Reset filters
          </button>
        )}
        <output className="holdings-count">
          {displayed.length} {displayed.length === 1 ? 'company' : 'companies'}
          {filtering ? ' match' : ''}
        </output>
      </search>
      {displayed.length === 0 ? (
        <section className="panel empty-state">
          <h3>No matching holdings</h3>
          <p>
            {filtering
              ? 'Nothing matches your search or sector filter.'
              : 'You have no current holdings. Turn on fully sold companies to see your past positions.'}
          </p>
          <div className="row">
            <button type="button" className="secondary" onClick={reset}>
              Reset filters
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="panel table-panel holdings-desktop">
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map(([key, label, numeric]) => (
                    <TableHead
                      key={key}
                      aria-sort={ariaSort(key)}
                      className={numeric ? 'num-col' : undefined}
                    >
                      <button type="button" className="sort-head" onClick={() => toggleSort(key)}>
                        {label}
                        <span aria-hidden="true">
                          {sort?.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </span>
                      </button>
                    </TableHead>
                  ))}
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((h) => {
                  const weight = weightOf(h);
                  return (
                    <TableRow key={h.ticker}>
                      <TableCell>
                        <button type="button" className="quote-btn ticker" onClick={() => actions.view(h)}>
                          {h.ticker}
                        </button>
                        <small>
                          {h.name}
                          {h.sector ? ` · ${h.sector}` : ''}
                        </small>
                        {h.target > 0 && <span className="tag">SIP shortlist</span>}
                      </TableCell>
                      <TableCell className="num-col amount">{fmtShares(h.shares)}</TableCell>
                      <TableCell className="num-col amount">
                        {h.average === null ? 'Unknown' : pkr(h.average)}
                      </TableCell>
                      <TableCell className="num-col">
                        <button
                          type="button"
                          className="quote-btn amount"
                          aria-label={h.quote ? `Edit ${h.ticker} price` : `Add ${h.ticker} price`}
                          onClick={() => actions.price(h)}
                        >
                          {h.quote ? pkr(h.quote.price) : 'Add price'}
                        </button>
                        <PriceFreshness holding={h} stale={staleTickers.has(h.ticker)} />
                      </TableCell>
                      <TableCell className="num-col amount">
                        {h.value === null ? '—' : pkr(h.value)}
                      </TableCell>
                      <TableCell className="num-col amount">
                        <GainText value={h.gain} />
                      </TableCell>
                      <TableCell className="num-col">
                        {weight === null ? (
                          '—'
                        ) : (
                          <>
                            <span className="amount">{pct(weight)}</span>
                            <div className="bar" aria-hidden="true">
                              <i style={{ width: `${weight}%` }} />
                            </div>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="secondary compact icon-btn"
                            aria-label={`Actions for ${h.ticker}`}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => actions.view(h)}>View company</DropdownMenuItem>
                            {h.shares > 0 && (
                              <DropdownMenuItem onClick={() => actions.buy(h)}>Buy more</DropdownMenuItem>
                            )}
                            {h.shares > 0 && (
                              <DropdownMenuItem onClick={() => actions.sell(h)}>Sell</DropdownMenuItem>
                            )}
                            {h.shares > 0 && (
                              <DropdownMenuItem onClick={() => actions.dividend(h)}>Dividend</DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => actions.edit(h)}>Edit</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
          <ul className="holdings-cards" aria-label="Holdings">
            {displayed.map((h) => (
              <HoldingCard
                key={h.ticker}
                h={h}
                weight={weightOf(h)}
                stale={staleTickers.has(h.ticker)}
              />
            ))}
          </ul>
        </>
      )}
      <p className="table-note">
        A dash means unknown, not zero. Quotes may be delayed. Market values
        exclude cash and unrecorded corporate actions.
      </p>
    </>
  );
}
