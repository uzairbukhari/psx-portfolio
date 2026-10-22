'use client';
// The Monthly Picks shortlist: one table that shows every company you may buy, its score, what you already own and why it
// is or is not a pick this month. Ticking a company ranks it; clicking its name opens the reason.
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, DatabaseZap, Loader2, Plus, Search, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import type { PicksRow } from '@/lib/picks-view';
import { Segmented } from './ui-kit';
import { searchCompanies, useDirectory, type DirectoryCompany } from './use-directory';

export const MAX_SHORTLIST = 15;

type Props = {
  rows: PicksRow[];
  shortlistCount: number;
  order: 'ranked' | 'name';
  setOrder: (order: 'ranked' | 'name') => void;
  onToggle: (ticker: string) => void;
  onClearTicks: () => void;
  onRemove: (ticker: string) => void;
  onAdd: (entry: { ticker: string; name: string }) => void;
  /** Saved companies that are not on the list yet. */
  missingOwn: number;
  onAddSaved: () => void;
  openTicker: string | null;
  onOpen: (ticker: string | null) => void;
  /** The reason panel for one company (rendered under its row). */
  why: (ticker: string) => ReactNode;
  /** Companies on the list whose data is stale or missing, and the action that fetches it. */
  needData: number;
  canFetch: boolean;
  fetching: boolean;
  onFetch: () => void;
};

export default function PicksShortlist(props: Props) {
  const [find, setFind] = useState('');
  const [cursor, setCursor] = useState(0);
  const [query, setQuery] = useState('');
  const findRef = useRef<HTMLInputElement>(null);
  const directory = useDirectory();
  const listed = useMemo(() => new Set(props.rows.map((row) => row.ticker)), [props.rows]);
  const results = useMemo(() => searchCompanies(directory.companies, find, 8), [directory.companies, find]);
  const active = Math.min(cursor, Math.max(results.length - 1, 0));
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? props.rows.filter((row) => row.ticker.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle)) : props.rows;
  }, [props.rows, query]);

  function addFound(company: DirectoryCompany) {
    if (!listed.has(company.ticker)) props.onAdd({ ticker: company.ticker, name: company.name });
    setFind('');
    setCursor(0);
    findRef.current?.focus();
  }

  return (
    <section className="mp2-card" aria-label="Your shortlist">
      <div className="mp2-head">
        <h3>
          Your shortlist <span className="mp-count">{props.shortlistCount} / {MAX_SHORTLIST}</span>
        </h3>
        <div className="mp2-tools">
          {props.missingOwn > 0 && (
            <button type="button" data-slot="plain" className="link-button" onClick={props.onAddSaved}>
              Add my {props.missingOwn} saved {props.missingOwn === 1 ? 'company' : 'companies'}
            </button>
          )}
          <button type="button" data-slot="plain" className="link-button" disabled={!props.shortlistCount} onClick={props.onClearTicks}>
            Clear ticks
          </button>
          <Segmented
            label="Order"
            value={props.order}
            onChange={props.setOrder}
            options={[{ value: 'ranked', label: 'Ranked' }, { value: 'name', label: 'A to Z' }]}
          />
        </div>
      </div>

      <div className="mp2-add">
        <label className="mp-search mp-addco__field">
          <Plus size={15} />
          <input
            ref={findRef}
            aria-label="Search all PSX companies to add"
            placeholder="Add a PSX company: type a name or symbol, press Enter"
            value={find}
            autoComplete="off"
            onChange={(event) => {
              setFind(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor(Math.min(active + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor(Math.max(active - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (results[active]) addFound(results[active]);
              } else if (event.key === 'Escape') setFind('');
            }}
          />
          {find && (
            <button type="button" data-slot="plain" className="mp-addco__clear" aria-label="Clear search" onClick={() => { setFind(''); findRef.current?.focus(); }}>
              <X size={14} />
            </button>
          )}
        </label>
        {find.trim() && (
          <ul className="mp-addco__results" aria-label="PSX companies found">
            {directory.loading && <li className="muted">Loading the PSX company list…</li>}
            {directory.error && <li className="muted">{directory.error}</li>}
            {!directory.loading && !directory.error && !results.length && <li className="muted">No PSX company matches that.</li>}
            {results.map((hit, index) => {
              const added = listed.has(hit.ticker);
              return (
                <li key={hit.ticker} className={index === active ? 'active' : undefined}>
                  <button type="button" data-slot="plain" className="mp-addco__row" disabled={added} onMouseEnter={() => setCursor(index)} onClick={() => addFound(hit)}>
                    <span className="mp-option__text">
                      <b>{hit.ticker}</b>
                      <small title={hit.name}>{hit.name}{hit.sector ? ` · ${hit.sector}` : ''}</small>
                    </span>
                    {added ? <span className="mp-addco__state"><Check size={14} /> In your list</span> : <span className="mp-addco__state mp-addco__state--add"><Plus size={14} /> Add</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {props.rows.length > 8 && (
        <label className="mp-search">
          <Search size={15} />
          <input aria-label="Filter your list" placeholder="Filter your list" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      )}

      {props.needData > 0 && (
        <p className="mp2-callout">
          {props.needData} {props.needData === 1 ? 'company needs' : 'companies need'} fresh PSX data to be ranked well.{' '}
          {props.canFetch ? (
            <button type="button" data-slot="plain" className="link-button" disabled={props.fetching} onClick={props.onFetch}>
              {props.fetching ? <Loader2 className="spin" size={13} /> : <DatabaseZap size={13} />} {props.fetching ? 'Fetching…' : 'Fetch data now'}
            </button>
          ) : (
            'The daily PSX scrape fills it in after the close (17:00 PKT).'
          )}
        </p>
      )}

      {props.rows.length === 0 ? (
        <p className="muted">Your list is empty. Search above to add PSX companies.</p>
      ) : (
        <div className="mp-table-wrap">
          <table className="mp2-table">
            <thead>
              <tr>
                <th aria-label="Tick" />
                <th>Company</th>
                <th>Score</th>
                <th className="mp2-hide-sm">P/E</th>
                <th className="mp2-hide-sm">EPS YoY</th>
                <th>You own</th>
                <th>This month</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const open = props.openTicker === row.ticker;
                const blocked = !row.ticked && props.shortlistCount >= MAX_SHORTLIST;
                return (
                  <Fragment key={row.ticker}>
                    <tr
                      data-open={open}
                      className={row.ticked ? (row.rank ? undefined : 'is-out') : 'is-off'}
                    >
                      <td>
                        <Checkbox
                          aria-label={`${row.ticked ? 'Remove' : 'Add'} ${row.ticker} ${row.ticked ? 'from' : 'to'} this month's shortlist`}
                          checked={row.ticked}
                          disabled={blocked}
                          onCheckedChange={() => props.onToggle(row.ticker)}
                        />
                      </td>
                      <td>
                        <button type="button" data-slot="plain" className="mp2-co" aria-expanded={open} onClick={() => props.onOpen(open ? null : row.ticker)}>
                          <b>{row.ticker}</b>
                          <small className={row.stale ? 'is-stale' : undefined} title={row.name}>{row.name} · {row.dataNote}</small>
                        </button>
                      </td>
                      <td>
                        {row.score !== null ? (
                          <span className="mp2-score">
                            <span className="mp2-bar" aria-hidden="true"><i style={{ width: `${row.score}%` }} /></span>
                            {Math.round(row.score)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mp2-hide-sm">{row.peTtm ?? '—'}</td>
                      <td className="mp2-hide-sm">{row.epsYoYPct === null ? '—' : `${row.epsYoYPct > 0 ? '+' : ''}${Math.abs(row.epsYoYPct) > 500 ? '>500' : row.epsYoYPct}%`}</td>
                      <td>{row.ownPct === null ? '—' : `${row.ownPct}%`}</td>
                      <td>
                        {row.tag && <span className="mp2-tag" data-kind={row.tag.kind}>{row.tag.text}</span>}
                        <button type="button" data-slot="plain" className="mp2-remove" aria-label={`Remove ${row.ticker} from your list`} title="Remove from your list" onClick={() => props.onRemove(row.ticker)}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="mp2-why">
                        <td colSpan={7}>{props.why(row.ticker)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {props.rows.length > 0 && !shown.length && <p className="muted">No company on your list matches that.</p>}
    </section>
  );
}
