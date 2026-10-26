'use client';
/* oxlint-disable next/no-html-link-for-pages -- full page loads are intended: next/link throws in the vinext production build */
// The Analytics area of the admin console: Summary, Journeys, Engagement, Acquisition and Quality, one shared filter
// bar, every figure from GET /api/admin/analytics?lens=. Usage events only: no holdings, tickers or amounts exist here.

import { useEffect, useMemo, useState } from 'react';
import { Check, Link2, Plus, RefreshCw, X } from 'lucide-react';
import { EVENT_CATALOG } from '@/lib/analytics-events';
import type { LensResponse } from '@/lib/analytics-lenses';
import { FUNNEL_PRESETS } from '@/lib/analytics-journey';
import type { PlatformFilter, Segment } from '@/lib/analytics-rows';
import { bucketLabel, fmtCount, fmtDuration, fmtPct, humanize, nodeLabel, shortDate, stepLabel } from '@/lib/analytics-format';
import { barOption, donutOption, heatmapOption, hBarOption, linesOption, sankeyOption, scatterOption, stackedAreaOption } from '@/lib/chart-kit';
import { EChart } from './charts/echart';
import { PillSwitch } from './insight-card';
import { type LensSection } from './admin-sections';
import { Empty, ErrorCard, InfoTip, KpiTile, Panel, ShareList, Skeleton, Stat, urlParam, useLens, usePlatformSegment, writeUrl, type Filters } from './admin-analytics-kit';
import './admin-analytics.css';

const range = (d: { from: string; to: string }) => `${shortDate(d.from)} – ${shortDate(d.to)}`;
const filterText = (platform: PlatformFilter, segment: Segment) =>
  `${platform === 'all' ? 'All platforms' : humanize(platform)}, ${segment === 'all' ? 'everyone' : segment === 'new' ? 'new people' : 'returning people'}`;
const peopleLink = (keys: string[], from: string) => `/admin/users?keys=${keys.join(',')}&from=${encodeURIComponent(from)}`;

/** The workspace: filter bar, then the lens for this section. */
export default function AdminAnalytics({ section, days, includeInternal }: { section: LensSection; days: number; includeInternal: boolean }) {
  const { platform, setPlatform, segment, setSegment } = usePlatformSegment();
  const f: Filters = { days, platform, segment, includeInternal };
  const [copied, setCopied] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };
  return (
    <div className="aa-root">
      <div className="aa-filters" role="toolbar" aria-label="Analytics filters">
        <PillSwitch label="Platform" value={platform} onChange={setPlatform} options={[{ key: 'all', label: 'All platforms' }, { key: 'web', label: 'Web' }, { key: 'android', label: 'Android' }, { key: 'ios', label: 'iPhone' }]} />
        <PillSwitch label="People" value={segment} onChange={setSegment} options={[{ key: 'all', label: 'Everyone' }, { key: 'new', label: 'New' }, { key: 'returning', label: 'Returning' }]} />
        <span className="aa-grow" />
        <button type="button" data-slot="action" className="secondary compact" onClick={() => void copy()}>
          {copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />} {copied ? 'Link copied' : 'Copy link'}
        </button>
        <button type="button" data-slot="action" className="secondary compact" onClick={() => setReloadTick((n) => n + 1)}>
          <RefreshCw size={14} aria-hidden="true" /> Reload
        </button>
      </div>
      {section === 'pulse' && <SummaryLens f={f} tick={reloadTick} />}
      {section === 'journeys' && <JourneysLens f={f} tick={reloadTick} />}
      {section === 'engagement' && <EngagementLens f={f} tick={reloadTick} />}
      {section === 'acquisition' && <AcquisitionLens f={f} tick={reloadTick} />}
      {section === 'quality' && <QualityLens f={f} tick={reloadTick} />}
    </div>
  );
}

/** Reloads a lens when the filter bar's Reload is pressed (skipping the first render). */
function useReload(reload: () => void, tick: number) {
  useEffect(() => {
    if (tick) reload();
  }, [tick, reload]);
}

function Stamp({ d, loading }: { d: { generatedAt: string; from: string; to: string; prevFrom: string; prevTo: string; truncated?: boolean }; loading: boolean }) {
  const at = new Date(d.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
  return (
    <p className="aa-stamp" aria-live="polite">
      {range(d)}, compared with {range({ from: d.prevFrom, to: d.prevTo })}. Data as of {at} PKT{loading ? ', updating…' : '.'}
      {d.truncated && ' The row limit was reached, so the oldest days may be incomplete.'}
    </p>
  );
}

// ───────────────────────── Summary ─────────────────────────

function SummaryLens({ f, tick }: { f: Filters; tick: number }) {
  const { data: d, error, loading, reload } = useLens('summary', f);
  const search = typeof window === 'undefined' ? '' : window.location.search;
  useReload(reload, tick);
  if (!d) return error ? <ErrorCard message={error} onRetry={reload} /> : <Skeleton tiles={6} />;
  const period = range({ from: d.prevFrom, to: d.prevTo });
  const top = d.activationFunnel[0]?.users ?? 0;
  return (
    <>
      {error && <ErrorCard message={error} onRetry={reload} />}
      <section className="slab aa-pulse" aria-label="This period at a glance">
        <div className="aa-pulse__tiles">
          {d.kpis.map((k) => <KpiTile key={k.id} kpi={k} period={period} />)}
        </div>
        <aside className="aa-pulse__changes" aria-label="What changed">
          <h2>What changed</h2>
          {d.changes.length ? (
            <ol>
              {d.changes.slice(0, 5).map((c) => (
                <li key={c.id} data-tone={c.good ? 'good' : 'bad'}>
                  <span>{c.label}</span>
                  <b className="num">{c.delta! > 0 ? '+' : '−'}{Math.abs(c.delta!).toFixed(Math.abs(c.delta!) < 10 ? 1 : 0)}{c.unit === 'pts' ? ' pts' : '%'}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p>Nothing moved by more than one point against {period}.</p>
          )}
        </aside>
      </section>
      <Stamp d={d} loading={loading} />
      <div className="aa-grid">
        <Panel
          wide
          title="Active people"
          sub={`Daily, with rolling 7-day and 28-day counts. ${filterText(d.platform, d.segment)}.`}
          info="Active means the person sent any event that day. Weekly and monthly lines count distinct people over the last 7 and 28 days."
          table={{ header: ['Day', 'Daily', '7 days', '28 days', 'Stickiness'], rows: d.active.map((a) => [a.day, a.dau, a.wau, a.mau, fmtPct(a.stickiness)]) }}
        >
          <ActiveChart rows={d.active} />
        </Panel>
        <Panel
          title="Activation funnel"
          sub="Sign-ups in this period, steps within 14 days."
          info="Each step must happen after the one before it. Click a step's drop-off to see those people."
          table={{ header: ['Step', 'People', 'Of first step'], rows: d.activationFunnel.map((s) => [stepLabel(s.step), s.users, fmtPct(s.overall)]) }}
        >
          {top ? <FunnelBars steps={d.activationFunnel} /> : <Empty title="No sign-ups yet">New accounts in this period show up here as they create a vault and add their first holding.</Empty>}
        </Panel>
        <Panel title="Go deeper" sub="Each lens keeps these filters.">
          <ul className="aa-links">
            <li><a href={`/admin/journeys${search}`}><b>Journeys</b><span>Funnels, paths and time to first value</span></a></li>
            <li><a href={`/admin/engagement${search}`}><b>Engagement</b><span>Cohorts, lifecycle and feature adoption</span></a></li>
            <li><a href={`/admin/acquisition${search}`}><b>Acquisition</b><span>Sources, countries, devices and releases</span></a></li>
            <li><a href={`/admin/quality${search}`}><b>Quality</b><span>Crashes, errors and page speed</span></a></li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function ActiveChart({ rows }: { rows: { day: string; dau: number; wau: number; mau: number }[] }) {
  return (
    <>
      <Legend items={[['Daily', 0], ['7 days', 1], ['28 days', 2]]} />
      <EChart
        className="aa-chart aa-chart--hero"
        label={`Active people per day from ${rows[0]?.day} to ${rows.at(-1)?.day}; latest daily ${rows.at(-1)?.dau ?? 0}, 28-day ${rows.at(-1)?.mau ?? 0}.`}
        build={(t) =>
          linesOption(t, {
            cats: rows.map((r) => shortDate(r.day)),
            series: [
              { name: 'Daily', data: rows.map((r) => r.dau), color: t.cat[0] },
              { name: '7 days', data: rows.map((r) => r.wau), color: t.cat[1] },
              { name: '28 days', data: rows.map((r) => r.mau), color: t.cat[2], dash: true },
            ],
            valueFormat: (n) => fmtCount(n),
          })
        }
      />
    </>
  );
}

/** A legend for HTML-labelled charts: the swatch takes the categorical token in fixed order. */
function Legend({ items }: { items: [string, number][] }) {
  return (
    <ul className="aa-legend">
      {items.map(([name, i]) => (
        <li key={name}><i style={{ background: `var(--cat-${i + 1})` }} aria-hidden="true" />{name}</li>
      ))}
    </ul>
  );
}

type FunnelStepData = LensResponse<'journeys'>['funnel'][number];

/** The funnel as rows: bar length is the share of the first step; conversion and time from the step before. */
function FunnelBars({ steps }: { steps: FunnelStepData[] }) {
  const top = steps[0]?.users ?? 0;
  return (
    <ol className="aa-funnel">
      {steps.map((s, i) => (
        <li key={s.step}>
          <div className="aa-funnel__row">
            <span className="aa-funnel__name">{stepLabel(s.step)}</span>
            <span className="aa-funnel__val num">{fmtCount(s.users)} <small>{fmtPct(s.overall)}</small></span>
          </div>
          <span className="aa-funnel__bar" aria-hidden="true"><i style={{ width: `${top ? (s.users / top) * 100 : 0}%` }} /></span>
          {i < steps.length - 1 && (
            <p className="aa-funnel__gap">
              {steps[i + 1].fromPrevious !== null && <>{fmtPct(steps[i + 1].fromPrevious)} continue</>}
              {steps[i + 1].medianMsFromPrevious !== null && <>, median {fmtDuration(steps[i + 1].medianMsFromPrevious)}</>}
              {s.dropped.length > 0 && (
                <> · <a href={peopleLink(s.dropped, `stopped after "${stepLabel(s.step)}"`)}>{s.dropped.length}{s.dropped.length === 50 ? '+' : ''} stopped here</a></>
              )}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

// ───────────────────────── Journeys ─────────────────────────

/** Every step the funnel builder offers: each catalog event, and screens and dialogs by name. */
function stepOptions(): string[] {
  const out: string[] = [];
  for (const [event, props] of Object.entries(EVENT_CATALOG)) {
    if (['account_state', 'web_vital', 'timing', 'account_snapshot', 'client_error', 'signed_in'].includes(event)) continue;
    const p = props as Record<string, readonly string[]>;
    if (event === 'screen_viewed') for (const s of p.screen) out.push(`screen_viewed:screen=${s}`);
    else if (event === 'dialog_opened') for (const s of p.dialog) out.push(`dialog_opened:dialog=${s}`);
    else out.push(event);
  }
  return out;
}

function JourneysLens({ f, tick }: { f: Filters; tick: number }) {
  const [preset, setPreset] = useState(() => urlParam('funnel', ['activation', 'import', 'picks', 'add_entry', 'onboarding', 'custom'] as const, 'activation'));
  const [custom, setCustom] = useState<string[]>(() => {
    const s = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('steps');
    return s ? s.split(',').slice(0, 8) : ['signed_up', 'vault_created'];
  });
  const [windowDays, setWindowDays] = useState(() => urlParam('window', ['1', '7', '14', '30'] as const, '14'));
  const [anchor, setAnchor] = useState<string | undefined>(() => (typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search).get('anchor') ?? undefined));
  const [direction, setDirection] = useState(() => urlParam('direction', ['next', 'prev'] as const, 'next'));
  const [adding, setAdding] = useState('');
  const options = useMemo(() => stepOptions(), []);
  const steps = preset === 'custom' ? custom : FUNNEL_PRESETS.find((p) => p.id === preset)?.steps;
  const { data: d, error, loading, reload } = useLens('journeys', f, { steps: steps?.join(','), window: windowDays, anchor, direction });
  useReload(reload, tick);
  useEffect(() => writeUrl({ funnel: preset === 'activation' ? null : preset, steps: preset === 'custom' ? custom.join(',') : null, window: windowDays === '14' ? null : windowDays, anchor: anchor ?? null, direction: direction === 'next' ? null : direction }), [preset, custom, windowDays, anchor, direction]);
  if (!d) return error ? <ErrorCard message={error} onRetry={reload} /> : <Skeleton tiles={3} />;
  const vault = d.milestones.find((m) => m.id === 'vault');
  const first = d.milestones.find((m) => m.id === 'first_entry');
  return (
    <>
      {error && <ErrorCard message={error} onRetry={reload} />}
      <div className="aa-stats">
        <Stat label="Entered the funnel" value={fmtCount(d.funnel[0]?.users ?? 0)} hint="People who did the first step in this period." />
        <Stat label="Finished it" value={fmtPct(d.funnel.at(-1)?.overall ?? null)} hint="Share of those people who reached the last step in time." />
        <Stat label="Sign-up to vault" value={fmtDuration(vault?.medianMs)} hint="Median time from signing up to creating the vault." />
        <Stat label="Sign-up to first holding" value={fmtDuration(first?.medianMs)} hint="Median time from signing up to adding a holding, an asset or an import." />
      </div>
      <Stamp d={{ ...d, generatedAt: d.generatedAt }} loading={loading} />
      <div className="aa-grid">
        <Panel
          wide
          title="Funnel"
          sub={`${d.funnel[0]?.users ?? 0} people entered, steps within ${d.windowDays} ${d.windowDays === 1 ? 'day' : 'days'}. ${filterText(d.platform, d.segment)}.`}
          info="Strict order: each step must come after the one before it, within the window of the first step. Alternatives (A or B) count whichever comes first."
          table={{ header: ['Step', 'People', 'Of first step', 'From previous', 'Median time'], rows: d.funnel.map((s) => [stepLabel(s.step), s.users, fmtPct(s.overall), fmtPct(s.fromPrevious), fmtDuration(s.medianMsFromPrevious)]) }}
          actions={
            <>
              <label className="aa-select">
                <span className="sr-only">Funnel</span>
                <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
                  {d.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="custom">Build your own</option>
                </select>
              </label>
              <PillSwitch label="Window" value={windowDays} onChange={setWindowDays} options={(['1', '7', '14', '30'] as const).map((w) => ({ key: w, label: `${w}d` }))} />
            </>
          }
        >
          {preset === 'custom' && (
            <div className="aa-builder">
              <ol className="aa-builder__steps">
                {custom.map((s, i) => (
                  <li key={`${s}-${i}`}>
                    <span>{stepLabel(s)}</span>
                    <button type="button" data-slot="icon" className="aa-icon" aria-label={`Remove ${stepLabel(s)}`} onClick={() => setCustom((c) => c.filter((_, j) => j !== i))} disabled={custom.length <= 2}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
              <form className="aa-builder__add" onSubmit={(e) => { e.preventDefault(); if (adding) { setCustom((c) => [...c, adding].slice(0, 8)); setAdding(''); } }}>
                <label className="aa-select">
                  <span className="sr-only">Add a step</span>
                  <select value={adding} onChange={(e) => setAdding(e.target.value)}>
                    <option value="">Add a step…</option>
                    {options.map((o) => <option key={o} value={o}>{stepLabel(o)}</option>)}
                  </select>
                </label>
                <button type="submit" data-slot="action" className="secondary compact" disabled={!adding || custom.length >= 8}><Plus size={14} aria-hidden="true" /> Add</button>
              </form>
            </div>
          )}
          {d.funnel[0]?.users ? <FunnelBars steps={d.funnel} /> : <Empty title="Nobody did the first step yet">Pick a wider time range or a different first step.</Empty>}
        </Panel>
        <Panel
          wide
          title={direction === 'next' ? `After ${nodeLabel(d.anchor)}` : `Before ${nodeLabel(d.anchor)}`}
          sub={`${d.paths.sessions} visits, three steps ${direction === 'next' ? 'on' : 'back'}. Less common steps are grouped as Other.`}
          info="Each visit counts once, from the first time it reached the starting point. A visit ends after 30 minutes without activity."
          table={{ header: ['From', 'To', 'Visits'], rows: d.paths.links.map((l) => [nodeLabel(l.source.slice(l.source.indexOf(':') + 1)), nodeLabel(l.target.slice(l.target.indexOf(':') + 1)), l.value]) }}
          actions={
            <>
              <label className="aa-select">
                <span className="sr-only">Starting point</span>
                <select value={d.anchor} onChange={(e) => setAnchor(e.target.value)}>
                  {d.anchors.map((a) => <option key={a} value={a}>{nodeLabel(a)}</option>)}
                </select>
              </label>
              <PillSwitch label="Direction" value={direction} onChange={setDirection} options={[{ key: 'next', label: 'After' }, { key: 'prev', label: 'Before' }]} />
            </>
          }
        >
          {d.paths.sessions ? (
            <EChart
              className="aa-chart aa-chart--sankey"
              label={`Paths ${direction === 'next' ? 'after' : 'before'} ${nodeLabel(d.anchor)} across ${d.paths.sessions} visits.`}
              onPick={(p) => {
                const name = String(p.name);
                if (!name.includes('>') && name.includes(':')) {
                  const node = name.slice(name.indexOf(':') + 1);
                  if (node !== 'exit' && node !== 'start' && node !== 'other') setAnchor(node);
                }
              }}
              build={(t) => sankeyOption(t, { nodes: d.paths.nodes, links: d.paths.links, nodeLabel, valueFormat: fmtCount, anchor: d.anchor })}
            />
          ) : (
            <Empty title="No visits reached this point">Choose another starting point from the list.</Empty>
          )}
        </Panel>
        <Panel
          title="Time from sign-up"
          sub="People who signed up in this period."
          info="How long after signing up people reached each milestone. People who have not reached it yet are not in the timing."
          table={{ header: ['Milestone', 'Signed up', 'Reached', 'Median'], rows: d.milestones.map((m) => [m.name, m.started, m.reached, fmtDuration(m.medianMs)]) }}
        >
          {d.milestones[0]?.started ? (
            <ul className="aa-milestones">
              {d.milestones.map((m) => (
                <li key={m.id}>
                  <div className="aa-funnel__row">
                    <span className="aa-funnel__name">{m.name}</span>
                    <span className="aa-funnel__val num">{fmtPct(m.started ? m.reached / m.started : null)} <small>median {fmtDuration(m.medianMs)}</small></span>
                  </div>
                  <span className="aa-spark-bars" aria-hidden="true">
                    {m.buckets.map((b) => <i key={b.bucket} title={`${b.bucket}: ${b.n}`} style={{ height: `${m.reached ? Math.max(6, (b.n / m.reached) * 100) : 6}%` }} />)}
                  </span>
                  <span className="aa-spark-axis" aria-hidden="true"><span>10 min</span><span>7 days +</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No sign-ups in this period">Milestones are measured from sign-up, so they fill in as new accounts arrive.</Empty>
          )}
        </Panel>
        <Panel
          title="Onboarding checklist"
          sub="Steps ticked in the in-app checklist, within 30 days."
          table={{ header: ['Step', 'People', 'Of first step'], rows: d.onboarding.map((s) => [stepLabel(s.step), s.users, fmtPct(s.overall)]) }}
        >
          {d.onboarding[0]?.users ? <FunnelBars steps={d.onboarding} /> : <Empty title="No checklist activity">The checklist shows to new accounts on Holdings; ticks appear here.</Empty>}
        </Panel>
      </div>
    </>
  );
}

// ───────────────────────── Engagement ─────────────────────────

function EngagementLens({ f, tick }: { f: Filters; tick: number }) {
  const { data: d, error, loading, reload } = useLens('engagement', f);
  useReload(reload, tick);
  const [cohort, setCohort] = useState<'weekly' | 'daily'>('weekly');
  if (!d) return error ? <ErrorCard message={error} onRetry={reload} /> : <Skeleton tiles={5} />;
  const last = d.active.at(-1);
  const s = d.sessions;
  const weekly = d.weekly.filter((c) => c.size > 0);
  const daily = d.daily;
  const adopt = d.features.filter((x) => x.users >= 2);
  const medAdopt = adopt.length ? [...adopt].sort((a, b) => (a.adoption ?? 0) - (b.adoption ?? 0))[Math.floor(adopt.length / 2)].adoption ?? 0 : 0;
  const medRepeat = adopt.length ? [...adopt].sort((a, b) => (a.repeat ?? 0) - (b.repeat ?? 0))[Math.floor(adopt.length / 2)].repeat ?? 0 : 0;
  return (
    <>
      {error && <ErrorCard message={error} onRetry={reload} />}
      <div className="aa-stats">
        <Stat label="Active today" value={fmtCount(last?.dau ?? 0)} />
        <Stat label="Active, 28 days" value={fmtCount(last?.mau ?? 0)} />
        <Stat label="Stickiness" value={fmtPct(last?.stickiness ?? null)} hint="Today's active people divided by the last 28 days'. Above 20% is a habit for a finance app." />
        <Stat label="Median visit" value={fmtDuration(s.medianMs)} hint="A visit ends after 30 minutes without activity." />
        <Stat label="Bounce rate" value={fmtPct(s.bounceRate)} tone={(s.bounceRate ?? 0) > 0.5 ? 'warn' : undefined} hint="Visits that saw one screen and did nothing." />
      </div>
      <Stamp d={d} loading={loading} />
      <div className="aa-grid">
        <Panel wide title="Active people" sub={`Daily, 7-day and 28-day. ${filterText(d.platform, 'all')}.`} table={{ header: ['Day', 'Daily', '7 days', '28 days'], rows: d.active.map((a) => [a.day, a.dau, a.wau, a.mau]) }}>
          <ActiveChart rows={d.active} />
        </Panel>
        <Panel
          title="Who was active each week"
          sub="New, returning and back after a break; churned below the line."
          info="New: first seen that week. Returning: also active the week before. Resurrected: back after at least a week away. Churned: active the week before, not this week."
          table={{ header: ['Week', 'New', 'Returning', 'Resurrected', 'Churned'], rows: d.lifecycle.map((w) => [w.week, w.new, w.returning, w.resurrected, w.churned]) }}
        >
          <EChart
            className="aa-chart"
            label={`Weekly lifecycle over ${d.lifecycle.length} weeks.`}
            build={(t) =>
              barOption(t, {
                cats: d.lifecycle.map((w) => shortDate(w.week)),
                stack: true,
                legend: true,
                integer: true,
                valueFormat: (n) => fmtCount(Math.abs(n)),
                series: [
                  { name: 'New', data: d.lifecycle.map((w) => w.new), color: t.cat[0] },
                  { name: 'Returning', data: d.lifecycle.map((w) => w.returning), color: t.cat[2] },
                  { name: 'Resurrected', data: d.lifecycle.map((w) => w.resurrected), color: t.cat[3] },
                  { name: 'Churned', data: d.lifecycle.map((w) => -w.churned), color: t.other },
                ],
              })
            }
          />
        </Panel>
        <Panel
          title="How many days a month"
          sub="Active days in the last 28, per person."
          info="People on the right come back most days. A curve that rises at the right is a sign of habit."
          table={{ header: ['Days active', 'People'], rows: d.power.map((n, i) => [i + 1, n]) }}
        >
          <EChart
            className="aa-chart"
            label="Distribution of active days in the last 28 days."
            build={(t) => barOption(t, { cats: d.power.map((_, i) => String(i + 1)), series: [{ name: 'People', data: d.power, color: t.primary }], valueFormat: fmtCount, integer: true, catTitle: (c) => `${c} of 28 days` })}
          />
        </Panel>
        <Panel
          wide
          title="Retention cohorts"
          sub={cohort === 'weekly' ? 'People who signed up each week, and the share active in each week after.' : 'People first seen each day, and the share back on each day after.'}
          info="Read across a row to see one cohort fade; read down a column to see whether newer cohorts keep more people."
          actions={<PillSwitch label="Cohort size" value={cohort} onChange={setCohort} options={[{ key: 'weekly', label: 'Weekly' }, { key: 'daily', label: 'Daily' }]} />}
          table={
            cohort === 'weekly'
              ? { header: ['Week', 'People', ...Array.from({ length: 9 }, (_, i) => `W${i}`)], rows: weekly.map((c) => [c.week, c.size, ...c.retained.map((v) => (v === null ? null : fmtPct(v)))]) }
              : { header: ['Day', 'People', ...Array.from({ length: 14 }, (_, i) => `D${i + 1}`)], rows: daily.map((c) => [c.day, c.size, ...c.retained.map((v) => (v === null ? null : fmtPct(v)))]) }
          }
        >
          {(cohort === 'weekly' ? weekly.length : daily.length) ? (
            <EChart
              className="aa-chart aa-chart--cohort"
              label={`${cohort === 'weekly' ? 'Weekly' : 'Daily'} retention cohorts.`}
              build={(t) => {
                const rows = cohort === 'weekly' ? weekly.map((c) => ({ name: `${shortDate(c.week)} (${c.size})`, values: c.retained })) : daily.map((c) => ({ name: `${shortDate(c.day)} (${c.size})`, values: c.retained }));
                const cols = cohort === 'weekly' ? Array.from({ length: 9 }, (_, i) => `W${i}`) : Array.from({ length: 14 }, (_, i) => `D${i + 1}`);
                return heatmapOption(t, {
                  cols,
                  rows: rows.map((r) => r.name),
                  cells: rows.flatMap((r, y) => r.values.flatMap((v, x) => (v === null ? [] : [[x, y, v] as [number, number, number]]))),
                  color: t.primary,
                  max: 1,
                  valueLabel: 'Active',
                  valueFormat: fmtPct,
                  title: (x, y) => `${rows[y].name}, ${cols[x]}`,
                });
              }}
            />
          ) : (
            <Empty title="No cohorts yet">Cohorts start with the first sign-ups recorded by usage tracking.</Empty>
          )}
        </Panel>
        <Panel
          wide
          title="Feature adoption and repeat use"
          sub="Share of active people who used each feature, against the share of them who used it again on another day. Dot size is people."
          info="Top right: widely used and used again (core). Bottom right: tried once and left (worth a look). Top left: a small group that relies on it."
          table={{ header: ['Feature', 'People', 'Adoption', 'Repeat', 'Uses'], rows: d.features.map((x) => [humanize(x.event), x.users, fmtPct(x.adoption), fmtPct(x.repeat), x.count]) }}
        >
          {adopt.length ? (
            <EChart
              className="aa-chart aa-chart--hero"
              label={`Feature adoption against repeat use for ${adopt.length} features.`}
              build={(t) =>
                scatterOption(t, {
                  points: adopt.map((x) => ({ name: humanize(x.event), x: x.adoption ?? 0, y: x.repeat ?? 0, size: x.users })),
                  xName: 'Adoption',
                  yName: 'Repeat use',
                  xFormat: fmtPct,
                  yFormat: fmtPct,
                  sizeLabel: 'People',
                  sizeFormat: fmtCount,
                  guides: { x: medAdopt, y: medRepeat },
                })
              }
            />
          ) : (
            <Empty title="Not enough feature use yet">Features used by at least two people appear here.</Empty>
          )}
        </Panel>
        <Panel title="Visit length" sub={`${fmtCount(s.sessions)} visits by ${fmtCount(s.users)} people.`} table={{ header: ['Length', 'Visits'], rows: s.duration.map((b) => [b.bucket, b.n]) }}>
          <EChart className="aa-chart aa-chart--short" label="Visits by length." build={(t) => barOption(t, { cats: s.duration.map((b) => b.bucket), series: [{ name: 'Visits', data: s.duration.map((b) => b.n), color: t.cat[0] }], valueFormat: fmtCount, integer: true })} />
        </Panel>
        <Panel title="Screens per visit" sub={`${s.avgScreens === null ? '–' : s.avgScreens.toFixed(1)} on average, ${s.perUserDay === null ? '–' : s.perUserDay.toFixed(1)} visits per person per day.`} table={{ header: ['Screens', 'Visits'], rows: s.depth.map((b) => [b.bucket, b.n]) }}>
          <EChart className="aa-chart aa-chart--short" label="Visits by number of screens." build={(t) => barOption(t, { cats: s.depth.map((b) => b.bucket), series: [{ name: 'Visits', data: s.depth.map((b) => b.n), color: t.cat[1] }], valueFormat: fmtCount, integer: true })} />
        </Panel>
        <Panel title="Where visits start" table={{ header: ['Screen', 'Visits'], rows: s.entry.map((r) => [humanize(r.key), r.n]) }}>
          <ShareList rows={s.entry} label={humanize} format={fmtCount} />
        </Panel>
        <Panel title="Where visits end" table={{ header: ['Screen', 'Visits'], rows: s.exit.map((r) => [humanize(r.key), r.n]) }}>
          <ShareList rows={s.exit} label={humanize} format={fmtCount} />
        </Panel>
        <Panel
          wide
          title="Account size"
          sub="Each person's latest account shape, in broad ranges only."
          info="Sent once per visit after unlock: how many companies, portfolios and kinds of asset, never which ones or how much."
        >
          <div className="aa-mix">
            {(
              [
                ['Companies held', d.snapshot.positions],
                ['Portfolios', d.snapshot.portfolios],
                ['Asset kinds', d.snapshot.classes],
                ['Ledger age', d.snapshot.ledger_age],
              ] as const
            ).map(([name, rows]) => (
              <div key={name}>
                <h3>{name}</h3>
                <ShareList rows={rows} label={bucketLabel} format={fmtCount} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ───────────────────────── Acquisition ─────────────────────────

function AcquisitionLens({ f, tick }: { f: Filters; tick: number }) {
  const { data: d, error, loading, reload } = useLens('acquisition', f);
  useReload(reload, tick);
  if (!d) return error ? <ErrorCard message={error} onRetry={reload} /> : <Skeleton tiles={4} />;
  const signups = d.channels.reduce((a, c) => a + c.signups, 0);
  const activated = d.channels.reduce((a, c) => a + c.activated, 0);
  const best = [...d.channels].filter((c) => c.signups >= 3).sort((a, b) => (b.activation ?? 0) - (a.activation ?? 0))[0];
  const refs = [...new Set(d.weekly.flatMap((w) => Object.keys(w.byRef)))].sort((a, b) => (a === 'direct' ? -1 : b === 'direct' ? 1 : a.localeCompare(b)));
  const sourceTable = (rows: typeof d.channels) => ({ header: ['Source', 'Sign-ups', 'Activated', 'Activation', 'Week-1 retention'], rows: rows.map((c) => [humanize(c.key), c.signups, c.activated, fmtPct(c.activation), fmtPct(c.retainedW1)]) });
  return (
    <>
      {error && <ErrorCard message={error} onRetry={reload} />}
      <div className="aa-stats">
        <Stat label="New sign-ups" value={fmtCount(signups)} />
        <Stat label="Activated" value={fmtPct(signups ? activated / signups : null)} hint="Added a holding, an asset or an import within 7 days of signing up." />
        <Stat label="Best source" value={best ? humanize(best.key) : '–'} hint="Highest activation among sources with at least three sign-ups." />
        <Stat label="Countries" value={fmtCount(d.mix.country.filter((c) => c.key !== 'unknown').length)} />
      </div>
      <Stamp d={d} loading={loading} />
      <div className="aa-grid">
        <Panel wide title="Sign-ups by source" sub="Per week, by the social channel on the link people followed (Direct when none)." table={{ header: ['Week', ...refs.map(humanize)], rows: d.weekly.map((w) => [w.week, ...refs.map((r) => w.byRef[r] ?? 0)]) }}>
          {signups ? (
            <EChart
              className="aa-chart aa-chart--hero"
              label={`Weekly sign-ups by source, ${signups} in total.`}
              build={(t) =>
                barOption(t, {
                  cats: d.weekly.map((w) => shortDate(w.week)),
                  stack: true,
                  legend: true,
                  integer: true,
                  valueFormat: fmtCount,
                  // Colour follows the source name (alphabetical, Direct first), never its rank this period.
                  series: refs.map((r, i) => ({ name: humanize(r), data: d.weekly.map((w) => w.byRef[r] ?? 0), color: r === 'direct' ? t.other : t.cat[i % t.cat.length] })),
                })
              }
            />
          ) : (
            <Empty title="No sign-ups in this period">Share a link with <code>?ref=whatsapp</code> (or another channel) to see it here.</Empty>
          )}
        </Panel>
        <Panel title="Sources" sub="Which channels bring people who stay." info="Activation: added something within 7 days. Week-1 retention: active again 7 to 13 days after signing up (only sign-ups at least 13 days old)." table={sourceTable(d.channels)}>
          <SourceTable rows={d.channels} />
        </Panel>
        <Panel title="Sign-in buttons" sub="Which button on the website people clicked first." table={sourceTable(d.buttons)}>
          <SourceTable rows={d.buttons} />
        </Panel>
        <Panel title="Countries" sub="Each person once, from their latest visit." table={{ header: ['Country', 'People'], rows: d.mix.country.map((c) => [c.key, c.n]) }}>
          <ShareList rows={d.mix.country} label={countryName} format={fmtCount} />
        </Panel>
        <Panel title="Platform and device" table={{ header: ['Kind', 'People'], rows: [...d.mix.platform.map((c) => [humanize(c.key), c.n]), ...d.mix.formFactor.map((c) => [humanize(c.key), c.n])] }}>
          <div className="aa-donuts">
            <MixDonut title="Platform" rows={d.mix.platform} />
            <MixDonut title="Device" rows={d.mix.formFactor} />
          </div>
        </Panel>
        <Panel title="Operating system" table={{ header: ['OS', 'People'], rows: d.mix.os.map((c) => [humanize(c.key), c.n]) }}>
          <ShareList rows={d.mix.os} label={humanize} format={fmtCount} />
        </Panel>
        <Panel title="Browser" sub="Web visits; the phone apps show as Phone app." table={{ header: ['Browser', 'People'], rows: d.mix.browser.map((c) => [humanize(c.key), c.n]) }}>
          <ShareList rows={d.mix.browser} label={humanize} format={fmtCount} />
        </Panel>
        <Panel wide title="Release adoption" sub="People per day on each release (platform and version)." info="Web releases are the build's short commit; phone releases are the app version." table={{ header: ['Day', ...d.versions.versions], rows: d.versions.days.map((x) => [x.day, ...d.versions.versions.map((v) => x.byVersion[v] ?? 0)]) }}>
          {d.versions.versions.length ? (
            <EChart
              className="aa-chart aa-chart--hero"
              label={`People per day on each of ${d.versions.versions.length} releases.`}
              build={(t) =>
                stackedAreaOption(t, {
                  dates: d.versions.days.map((x) => x.day),
                  series: d.versions.versions.map((v, i) => ({ name: v, data: d.versions.days.map((x) => x.byVersion[v] ?? 0), color: v === 'other' ? t.other : t.cat[i % t.cat.length] })),
                  valueFormat: fmtCount,
                  dateLabel: (x) => shortDate(x),
                })
              }
            />
          ) : (
            <Empty title="No releases recorded">Releases appear once clients send their version.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}

function SourceTable({ rows }: { rows: LensResponse<'acquisition'>['channels'] }) {
  if (!rows.length) return <p className="aa-empty-line">No sign-ups in this period.</p>;
  return (
    <div className="aa-table-wrap">
      <table className="aa-table">
        <thead>
          <tr><th scope="col">Source</th><th scope="col" className="num">Sign-ups</th><th scope="col" className="num">Activation</th><th scope="col" className="num">Week 1</th></tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.key}>
              <th scope="row">{humanize(c.key)}</th>
              <td className="num">{fmtCount(c.signups)}</td>
              <td className="num"><Meter value={c.activation} /></td>
              <td className="num"><Meter value={c.retainedW1} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A share with a thin bar behind the number. */
function Meter({ value }: { value: number | null }) {
  return (
    <span className="aa-meter">
      <span aria-hidden="true"><i style={{ width: `${(value ?? 0) * 100}%` }} /></span>
      {fmtPct(value)}
    </span>
  );
}

function MixDonut({ title, rows }: { title: string; rows: { key: string; n: number }[] }) {
  const order = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  if (!rows.length) return null;
  return (
    <figure className="aa-donut">
      <EChart
        className="aa-chart aa-chart--donut"
        label={`${title}: ${rows.map((r) => `${humanize(r.key)} ${r.n}`).join(', ')}.`}
        build={(t) => donutOption(t, { slices: order.map((r, i) => ({ name: humanize(r.key), value: r.n, color: r.key === 'unknown' ? t.other : t.cat[i % t.cat.length] })), valueFormat: fmtCount, centerTitle: title })}
      />
      <figcaption>
        <ul className="aa-legend aa-legend--col">
          {order.map((r, i) => (
            <li key={r.key}><i style={{ background: r.key === 'unknown' ? 'var(--chart-other)' : `var(--cat-${(i % 7) + 1})` }} aria-hidden="true" />{humanize(r.key)} <b className="num">{fmtCount(r.n)}</b></li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code: string) => (code === 'unknown' || code === 'other' ? humanize(code) : (regionNames?.of(code) ?? code));

// ───────────────────────── Quality ─────────────────────────

const VITAL_INFO: Record<string, { name: string; info: string }> = {
  lcp: { name: 'Largest paint', info: 'LCP: when the main content appears. Good under 2.5 s.' },
  inp: { name: 'Response to taps', info: 'INP: how quickly the page responds to a click or tap. Good under 200 ms.' },
  cls: { name: 'Layout shift', info: 'CLS: how much the page jumps while loading. Good under 0.1.' },
  fcp: { name: 'First paint', info: 'FCP: when anything first appears. Good under 1.8 s.' },
  ttfb: { name: 'Server response', info: 'TTFB: time to the first byte from the server. Good under 0.8 s.' },
};
const RATING = { good: 'Good', ni: 'Needs work', poor: 'Poor' } as const;

function QualityLens({ f, tick }: { f: Filters; tick: number }) {
  const [screen, setScreen] = useState<string>(() => (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('screen') ?? ''));
  const { data: d, error, loading, reload } = useLens('quality', f, { screen: screen || undefined });
  useReload(reload, tick);
  useEffect(() => writeUrl({ screen: screen || null }), [screen]);
  if (!d) return error ? <ErrorCard message={error} onRetry={reload} /> : <Skeleton tiles={4} />;
  const total = d.series.reduce((a, x) => a + x.sessions, 0);
  const weighted = (k: 'crashFree' | 'errorFree') => (total ? d.series.reduce((a, x) => a + (x[k] ?? 0) * x.sessions, 0) / total : null);
  const errors = d.byPlatform.reduce((a, x) => a + x.errors, 0);
  const lcp = d.vitals.find((v) => v.metric === 'lcp');
  return (
    <>
      {error && <ErrorCard message={error} onRetry={reload} />}
      <div className="aa-stats">
        <Stat label="Crash-free visits" value={fmtPct(weighted('crashFree'))} tone={(weighted('crashFree') ?? 1) < 0.99 ? 'bad' : 'good'} hint="Visits without an uncaught error. Aim for 99.5% or better." />
        <Stat label="Error-free visits" value={fmtPct(weighted('errorFree'))} hint="Visits without any recorded error, handled or not." />
        <Stat label="Errors per 1,000 visits" value={total ? fmtCount((errors / total) * 1000) : '–'} />
        <Stat label="Page load (LCP)" value={lcp?.rating ? RATING[lcp.rating] : '–'} tone={lcp?.rating === 'poor' ? 'bad' : lcp?.rating === 'ni' ? 'warn' : lcp?.rating === 'good' ? 'good' : undefined} hint={VITAL_INFO.lcp.info} />
      </div>
      <Stamp d={d} loading={loading} />
      <div className="aa-grid">
        <Panel wide title="Stability" sub={`Share of visits per day. ${filterText(d.platform, d.segment)}.`} table={{ header: ['Day', 'Visits', 'Crash-free', 'Error-free'], rows: d.series.map((x) => [x.day, x.sessions, fmtPct(x.crashFree), fmtPct(x.errorFree)]) }}>
          {total ? (
            <>
              <Legend items={[['Crash-free', 0], ['Error-free', 1]]} />
              <EChart
                className="aa-chart aa-chart--hero"
                label="Crash-free and error-free visits per day."
                build={(t) =>
                  linesOption(t, {
                    cats: d.series.map((x) => shortDate(x.day)),
                    series: [
                      // Plotted as percents so the axis reads 90% rather than 0.9.
                      { name: 'Crash-free', data: d.series.map((x) => Math.round((x.crashFree ?? 1) * 1000) / 10), color: t.cat[0] },
                      { name: 'Error-free', data: d.series.map((x) => Math.round((x.errorFree ?? 1) * 1000) / 10), color: t.cat[1] },
                    ],
                    valueFormat: (n) => `${n}%`,
                    axisFormat: (n) => `${n}%`,
                  })
                }
              />
            </>
          ) : (
            <Empty title="No visits in this period">Pick a wider range.</Empty>
          )}
        </Panel>
        <Panel
          wide
          title="Page speed"
          sub={`Core Web Vitals on the web, ${d.vitalScreen ? `on ${humanize(d.vitalScreen)}` : 'all screens'}. Rating follows Google's thresholds at the 75th percentile.`}
          actions={
            <label className="aa-select">
              <span className="sr-only">Screen</span>
              <select value={screen} onChange={(e) => setScreen(e.target.value)}>
                <option value="">All screens</option>
                {d.vitalScreens.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </select>
            </label>
          }
          table={{ header: ['Metric', 'Samples', 'Good', 'Needs work', 'Poor', 'p75'], rows: d.vitals.map((v) => [VITAL_INFO[v.metric].name, v.samples, fmtPct(v.good), fmtPct(v.ni), fmtPct(v.poor), v.p75 ? bucketLabel(v.p75) : null]) }}
        >
          <div className="aa-vitals">
            {d.vitals.map((v) => (
              <article key={v.metric} className="aa-vital" data-rating={v.rating ?? 'none'}>
                <header>
                  <span>{VITAL_INFO[v.metric].name}</span>
                  <InfoTip text={VITAL_INFO[v.metric].info} />
                </header>
                <strong className="num">{v.p75 ? bucketLabel(v.p75) : '–'}</strong>
                <span className="aa-vital__rating">{v.rating ? RATING[v.rating] : 'No samples'}</span>
                <span className="aa-vital__bar" aria-hidden="true">
                  <i data-k="good" style={{ width: `${(v.good ?? 0) * 100}%` }} />
                  <i data-k="ni" style={{ width: `${(v.ni ?? 0) * 100}%` }} />
                  <i data-k="poor" style={{ width: `${(v.poor ?? 0) * 100}%` }} />
                </span>
                <small>{fmtCount(v.samples)} samples</small>
              </article>
            ))}
          </div>
        </Panel>
        <Panel title="Errors by release" sub="Releases with at least five visits." table={{ header: ['Release', 'Visits', 'Errors', 'Per 1,000 visits'], rows: d.byVersion.map((r) => [r.key, r.sessions, r.errors, r.per1k === null ? null : Math.round(r.per1k)]) }}>
          {d.byVersion.length ? (
            <EChart
              className="aa-chart"
              height={Math.max(160, d.byVersion.slice(0, 10).length * 30 + 20)}
              label={`Errors per 1,000 visits for ${d.byVersion.length} releases.`}
              build={(t) => hBarOption(t, { name: 'Per 1,000 visits', cats: d.byVersion.slice(0, 10).map((r) => r.key), values: d.byVersion.slice(0, 10).map((r) => r.per1k), valueFormat: (n) => fmtCount(n), color: t.danger, rows: (i) => [{ label: 'Visits', value: fmtCount(d.byVersion[i].sessions) }] })}
            />
          ) : (
            <p className="aa-empty-line">Not enough visits per release yet.</p>
          )}
        </Panel>
        <Panel title="Where errors happen" sub="The screen, and the most common category and code." info="From the error's own screen, or the last screen viewed before it in the visit." table={{ header: ['Screen', 'Errors', 'Top codes'], rows: d.byScreen.map((r) => [humanize(r.key), r.n, r.codes.map((c) => `${c.key} (${c.n})`).join('; ')]) }}>
          {d.byScreen.length ? (
            <ul className="aa-errors">
              {d.byScreen.map((r) => (
                <li key={r.key}>
                  <div className="aa-funnel__row">
                    <span className="aa-funnel__name">{humanize(r.key)}</span>
                    <span className="aa-funnel__val num">{fmtCount(r.n)}</span>
                  </div>
                  <p>
                    {r.codes.map((c, i) => (
                      <span key={c.key}>{i ? ', ' : ''}<a href={`/admin/audit?code=${encodeURIComponent(c.key.split('/')[1] ?? '')}`}>{c.key}</a> {c.n}</span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No errors recorded">Nothing broke for anyone in this period.</Empty>
          )}
        </Panel>
        <Panel title="Errors by platform" table={{ header: ['Platform', 'Visits', 'Errors', 'Per 1,000 visits'], rows: d.byPlatform.map((r) => [humanize(r.key), r.sessions, r.errors, r.per1k === null ? null : Math.round(r.per1k)]) }}>
          <ul className="aa-share">
            {d.byPlatform.map((r) => (
              <li key={r.key}>
                <span className="aa-share__name">{humanize(r.key)}</span>
                <span className="aa-share__bar aa-share__bar--bad" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.per1k ?? 0) / 10)}%` }} /></span>
                <span className="aa-share__val num">{fmtCount(r.per1k)} <small>per 1,000</small></span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Timed steps" sub="How long key steps took, as ranges." table={{ header: ['Step', 'Samples', 'Typical', 'Slowest 10%'], rows: d.timings.map((x) => [humanize(x.op), x.samples, x.p50 ? bucketLabel(x.p50) : null, x.p90 ? bucketLabel(x.p90) : null]) }}>
          {d.timings.length ? (
            <ul className="aa-timings">
              {d.timings.map((x) => (
                <li key={x.op}>
                  <div className="aa-funnel__row">
                    <span className="aa-funnel__name">{humanize(x.op)}</span>
                    <span className="aa-funnel__val num">{x.p50 ? bucketLabel(x.p50) : '–'} <small>slowest 10% {x.p90 ? bucketLabel(x.p90) : '–'}</small></span>
                  </div>
                  <span className="aa-spark-bars" aria-hidden="true">
                    {x.buckets.map((b) => <i key={b.bucket} title={`${bucketLabel(b.bucket)}: ${b.n}`} style={{ height: `${x.samples ? Math.max(6, (b.n / x.samples) * 100) : 6}%` }} />)}
                  </span>
                  <span className="aa-spark-axis" aria-hidden="true"><span>&lt; 250 ms</span><span>10 s +</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No timings yet">Vault unlock and Monthly Picks timings appear after the next release.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
