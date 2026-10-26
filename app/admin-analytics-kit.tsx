'use client';
// Building blocks shared by the Analytics lenses in the admin console: the data hook, the filter state kept in the
// URL, chart panels with a definition and a table view, KPI tiles, delta pills, and the loading, empty and error states.

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { Download, Info, RefreshCw, Table2 } from 'lucide-react';
import type { Lens, LensResponse } from '@/lib/analytics-lenses';
import type { PlatformFilter, Segment } from '@/lib/analytics-rows';
import { delta, fmtValue, toCsv } from '@/lib/analytics-format';
import { sparklineOption } from '@/lib/chart-kit';
import { readJson } from '@/lib/safe-json';
import { EChart } from './charts/echart';

export type Filters = { days: number; platform: PlatformFilter; segment: Segment; includeInternal: boolean };

const PLATFORMS: PlatformFilter[] = ['all', 'web', 'android', 'ios'];
const SEGMENTS: Segment[] = ['all', 'new', 'returning'];

/** Reads a filter from the address bar, so a copied link opens the same view. */
export function urlParam<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const v = new URLSearchParams(window.location.search).get(name);
  return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
}

/** Writes filters into the address bar without a page load; `null` removes one. */
export function writeUrl(values: Record<string, string | null>) {
  if (typeof window === 'undefined') return;
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(values)) {
    if (v === null || v === '') q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
}

export function usePlatformSegment() {
  const [platform, setPlatformState] = useState<PlatformFilter>('all');
  const [segment, setSegmentState] = useState<Segment>('all');
  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPlatformState(urlParam('platform', PLATFORMS, 'all'));
      setSegmentState(urlParam('segment', SEGMENTS, 'all'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const setPlatform = (p: PlatformFilter) => {
    setPlatformState(p);
    writeUrl({ platform: p === 'all' ? null : p });
  };
  const setSegment = (s: Segment) => {
    setSegmentState(s);
    writeUrl({ segment: s === 'all' ? null : s });
  };
  return { platform, setPlatform, segment, setSegment };
}

type LensState<L extends Lens> = { data: LensResponse<L> | null; error: string | null; loading: boolean; reload: () => void };

/** Loads one lens. Keeps the last result on screen while a new one loads, so filters do not flash the page empty. */
export function useLens<L extends Lens>(lens: L, f: Filters, extra: Record<string, string | undefined> = {}): LensState<L> {
  const [data, setData] = useState<LensResponse<L> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const extraKey = JSON.stringify(extra);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ lens, days: String(f.days), platform: f.platform, segment: f.segment });
    if (f.includeInternal) q.set('admin', '1');
    if (nonce) q.set('fresh', '1');
    for (const [k, v] of Object.entries(JSON.parse(extraKey) as Record<string, string | undefined>)) if (v) q.set(k, v);
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/analytics?${q}`, { cache: 'no-store' });
        const body = (await readJson(res)) as LensResponse<L> & { error?: string };
        if (!res.ok) throw new Error(body.error ?? 'Could not load analytics.');
        if (live) setData(body);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load analytics.');
      } finally {
        if (live) setLoading(false);
      }
    }, 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [lens, f.days, f.platform, f.segment, f.includeInternal, extraKey, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

/** A hover and focus definition for a chart or tile. */
export function InfoTip({ text }: { text: string }) {
  return (
    <button type="button" data-slot="info" className="aa-info" aria-label={text} data-tip={text}>
      <Info size={14} aria-hidden="true" />
    </button>
  );
}

export type TableData = { header: string[]; rows: (string | number | null)[][] };

function download(name: string, t: TableData) {
  const blob = new Blob([toCsv(t.header, t.rows)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * A card for one chart or list: title, a subtitle naming the window and filters, a definition, and when `table` is
 * given a table view (for screen readers and for exact numbers) plus CSV export.
 */
export function Panel({
  title,
  sub,
  info,
  table,
  actions,
  wide,
  children,
}: {
  title: string;
  sub?: string;
  info?: string;
  table?: TableData;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <section className={`aa-panel${wide ? ' aa-panel--wide' : ''}`} aria-labelledby={id}>
      <header className="aa-panel__head">
        <div>
          <h2 id={id}>
            {title}
            {info && <InfoTip text={info} />}
          </h2>
          {sub && <p>{sub}</p>}
        </div>
        <div className="aa-panel__actions">
          {actions}
          {table && (
            <>
              <button type="button" data-slot="icon" className="aa-icon" aria-pressed={asTable} aria-label={asTable ? 'Show chart' : 'Show as table'} title={asTable ? 'Show chart' : 'Show as table'} onClick={() => setAsTable((v) => !v)}>
                <Table2 size={15} aria-hidden="true" />
              </button>
              <button type="button" data-slot="icon" className="aa-icon" aria-label={`Download ${title} as CSV`} title="Download CSV" onClick={() => download(title, table)}>
                <Download size={15} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </header>
      {asTable && table ? <DataTable data={table} caption={title} /> : children}
    </section>
  );
}

export function DataTable({ data, caption }: { data: TableData; caption: string }) {
  return (
    <div className="aa-table-wrap">
      <table className="aa-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>{data.header.map((h, i) => <th key={h} className={i ? 'num' : undefined} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>
          {data.rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (j ? <td key={j} className="num">{c ?? '–'}</td> : <th key={j} scope="row">{c ?? '–'}</th>))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Up, down or flat, coloured by whether the change is good news, and always said in words as well. */
export function DeltaPill({ value, previous, format, better, period }: { value: number | null; previous: number | null; format: 'count' | 'pct' | 'duration'; better: 'up' | 'down'; period: string }) {
  const d = delta(value, previous, format, better);
  if (!d) return <span className="aa-delta" data-tone="flat">No earlier data</span>;
  const arrow = d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '■';
  const tone = d.good === null ? 'flat' : d.good ? 'good' : 'bad';
  return (
    <span className="aa-delta" data-tone={tone} title={`${d.text} compared with ${period} (${fmtValue(previous, format)})`}>
      <span aria-hidden="true">{arrow}</span> {d.text}
      <span className="sr-only">{d.good === null ? '' : d.good ? ', better' : ', worse'} than {period}</span>
    </span>
  );
}

export type KpiData = { id: string; label: string; value: number | null; previous: number | null; format: 'count' | 'pct' | 'duration'; better: 'up' | 'down'; spark: number[]; hint: string };

export function KpiTile({ kpi, period }: { kpi: KpiData; period: string }) {
  const d = delta(kpi.value, kpi.previous, kpi.format, kpi.better);
  return (
    <article className="aa-kpi">
      <span className="aa-kpi__label">
        {kpi.label}
        <InfoTip text={kpi.hint} />
      </span>
      <strong className="num">{fmtValue(kpi.value, kpi.format)}</strong>
      <DeltaPill value={kpi.value} previous={kpi.previous} format={kpi.format} better={kpi.better} period={period} />
      {kpi.spark.length > 1 ? (
        <EChart
          className="aa-kpi__spark"
          label={`${kpi.label} across the period.`}
          build={(t) => sparklineOption(t, { values: kpi.spark, color: d?.good === false ? t.danger : t.success })}
        />
      ) : (
        <div className="aa-kpi__spark" aria-hidden="true" />
      )}
    </article>
  );
}

/** A plain stat tile for the lens pages (no comparison). */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <article className="aa-stat" data-tone={tone}>
      <span className="aa-kpi__label">
        {label}
        {hint && <InfoTip text={hint} />}
      </span>
      <strong className="num">{value}</strong>
    </article>
  );
}

/** Shares of a whole as labelled bars: exact numbers in text, the bar only shows proportion. */
export function ShareList({ rows, label, format = (n) => String(n), limit = 10 }: { rows: { key: string; n: number }[]; label: (k: string) => string; format?: (n: number) => string; limit?: number }) {
  const total = rows.reduce((a, r) => a + r.n, 0);
  if (!rows.length || !total) return <p className="aa-empty-line">Nothing recorded yet.</p>;
  return (
    <ul className="aa-share">
      {rows.slice(0, limit).map((r) => (
        <li key={r.key}>
          <span className="aa-share__name">{label(r.key)}</span>
          <span className="aa-share__bar" aria-hidden="true"><i style={{ width: `${(r.n / total) * 100}%` }} /></span>
          <span className="aa-share__val num">{format(r.n)} <small>{Math.round((r.n / total) * 100)}%</small></span>
        </li>
      ))}
    </ul>
  );
}

export function Skeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="aa-skeleton" aria-busy="true" aria-label="Loading analytics">
      <div className="aa-skeleton__row">{Array.from({ length: tiles }, (_, i) => <div key={i} className="aa-shimmer aa-shimmer--tile" />)}</div>
      <div className="aa-shimmer aa-shimmer--hero" />
      <div className="aa-skeleton__row aa-skeleton__row--2">
        <div className="aa-shimmer aa-shimmer--card" />
        <div className="aa-shimmer aa-shimmer--card" />
      </div>
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="aa-error" role="alert">
      <strong>The report did not load.</strong>
      <p>{message}</p>
      <button type="button" data-slot="action" className="secondary compact" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" /> Try again
      </button>
    </div>
  );
}

/** What to do when a chart has nothing to show. */
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="aa-empty">
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
