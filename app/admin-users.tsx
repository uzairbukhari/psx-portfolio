'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- a chip row is a labelled group and the activity strip is described as an image, as in PillSwitch and EChart */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { UserDirectory, UserRow, UserTimeline } from '@/lib/admin-users-store';
import { hBarOption } from '@/lib/chart-kit';
import { readJson } from '@/lib/safe-json';
import { SEGMENT_LABEL, STAGE_LABEL, STAGES, type Segment, type Stage } from '@/lib/user-lifecycle';
import { EChart } from './charts/echart';
import { UserAvatar } from './user-avatar';

type SortKey = 'lastActive' | 'joined' | 'sessions' | 'activeDays30';

const ago = (iso: string, now = Date.now()) => {
  const days = Math.floor((now - new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
};
const date = (iso: string) => new Date(iso).toLocaleDateString();
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const platformLabel = (p: string) => (p === 'web' ? 'Web' : p === 'android' ? 'Android' : p === 'ios' ? 'iPhone' : 'Other');

/** People (GET /api/admin/users): every account, how far it got, and who needs a nudge. Activity only, never holdings or amounts. */
export default function AdminUsers({ includeInternal }: { includeInternal: boolean }) {
  const [dir, setDir] = useState<UserDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [segment, setSegment] = useState<Segment | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastActive', dir: -1 });
  const [open, setOpen] = useState<UserRow | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users${includeInternal ? '?admin=1' : ''}`, { cache: 'no-store' });
      const body = (await readJson(res)) as UserDirectory & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load people.');
      setDir(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load people.');
    }
  }, [includeInternal]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = useMemo(() => {
    if (!dir) return [];
    const q = query.trim().toLowerCase();
    const list = dir.users.filter((u) =>
      (!q || u.email.includes(q) || (u.name ?? '').toLowerCase().includes(q)) &&
      (!stage || u.stage === stage) &&
      (!segment || u.segments.includes(segment)));
    return list.sort((a, b) => (a[sort.key] > b[sort.key] ? 1 : a[sort.key] < b[sort.key] ? -1 : 0) * sort.dir);
  }, [dir, query, stage, segment, sort]);

  if (!dir) return error ? <p role="alert" className="notice error">{error}</p> : <p className="muted">Loading…</p>;

  const top = dir.funnel[0]?.reached || 0;
  const head = (key: SortKey, text: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" data-slot="sort" className="people-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
        {text}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(rows.map((r) => r.email).join(', '));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  };

  return (
    <div className="people">
      <h3>How far people got</h3>
      <EChart
        className="usage-chart people-funnel"
        label={`Furthest step reached: ${dir.funnel.map((f) => `${f.label} ${f.reached}`).join(', ')}.`}
        onPick={(p) => setStage((s) => (s === STAGES[p.dataIndex] ? null : STAGES[p.dataIndex]))}
        build={(t) =>
          hBarOption(t, {
            name: 'People',
            cats: dir.funnel.map((f) => f.label),
            values: dir.funnel.map((f) => f.reached),
            valueFormat: (n) => String(n),
            labelFormat: (n) => (top ? `${n} · ${Math.round((n / top) * 100)}%` : String(n)),
            color: t.primary,
            max: Math.max(1, top) * 1.25,
            selectable: true,
            rows: (i) => [{ label: 'Stopped here', value: String(dir.funnel[i].stuck) }],
          })
        }
      />
      <p className="muted">Click a bar to list the people whose furthest step is that one.</p>

      <h3>Who needs a nudge</h3>
      <div className="people-chips" role="group" aria-label="Follow-up lists">
        {dir.segments.map((s) => (
          <button key={s.id} type="button" data-slot="pill" aria-pressed={segment === s.id} data-active={segment === s.id || undefined}
            onClick={() => setSegment((c) => (c === s.id ? null : s.id))}>
            {s.label} <b className="num">{s.users}</b>
          </button>
        ))}
      </div>

      <div className="people-tools">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" aria-label="Search people" />
        {stage && <button type="button" data-slot="pill" data-active onClick={() => setStage(null)}>Step: {STAGE_LABEL[stage]} ✕</button>}
        <span className="admin-grow" />
        <span className="muted">{rows.length} of {dir.users.length}</span>
        <button type="button" className="secondary compact" onClick={() => void copy()} disabled={!rows.length}>{copied ? 'Copied' : 'Copy emails'}</button>
      </div>

      {rows.length ? (
        <div className="table-wrap">
          <table className="admin-table people-table">
            <thead>
              <tr>
                <th>Person</th><th>Furthest step</th>
                {head('lastActive', 'Last active')}{head('sessions', 'Sessions')}{head('activeDays30', 'Days, 30d')}
                <th>Platform</th>{head('joined', 'Joined')}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.email} className="people-row">
                  <td>
                    <button type="button" data-slot="row" className="people-person" onClick={() => setOpen(u)}>
                      <UserAvatar name={u.name} email={u.email} picture={u.picture} />
                      <span><b>{u.name || u.email}</b>{u.name && <small>{u.email}</small>}</span>
                      {u.internal && <em className="people-badge">Internal</em>}
                    </button>
                  </td>
                  <td><span className="people-stage" data-stage={u.stage}>{STAGE_LABEL[u.stage]}</span>{!u.hasUsage && <small className="muted"> · no usage events</small>}</td>
                  <td>{ago(u.lastActive)}</td>
                  <td className="num">{u.sessions}</td>
                  <td className="num">{u.activeDays30}</td>
                  <td>{platformLabel(u.platform)}</td>
                  <td>{date(u.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No one matches.</p>
      )}

      <Sheet open={!!open} onOpenChange={(v) => { if (!v) setOpen(null); }}>
        <SheetContent side="right" className="people-sheet">
          {open && <PersonDetail user={open} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PersonDetail({ user }: { user: UserRow }) {
  const [data, setData] = useState<UserTimeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/users/timeline?email=${encodeURIComponent(user.email)}`, { cache: 'no-store' });
        const body = (await readJson(res)) as UserTimeline & { error?: string };
        if (!res.ok) throw new Error(body.error ?? 'Could not load activity.');
        if (live) setData(body);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load activity.');
      }
    })();
    return () => { live = false; };
  }, [user.email]);
  const reached = STAGES.indexOf(user.stage);
  const peak = Math.max(1, ...(data?.activity.map((a) => a.n) ?? [1]));

  return (
    <>
      <SheetHeader>
        <div className="people-head">
          <UserAvatar name={user.name} email={user.email} picture={user.picture} large />
          <div>
            <SheetTitle>{user.name || user.email}</SheetTitle>
            <SheetDescription>{user.name ? user.email : 'No name stored yet'} · joined {date(user.joined)} · {platformLabel(user.platform)}</SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="people-detail">
        <ol className="people-steps" aria-label="Steps reached">
          {STAGES.map((s, i) => (
            <li key={s} data-done={i <= reached || undefined}>{STAGE_LABEL[s]}</li>
          ))}
        </ol>
        {user.segments.length > 0 && (
          <div className="people-chips">
            {user.segments.map((s) => <span key={s} className="people-badge">{SEGMENT_LABEL[s]}</span>)}
          </div>
        )}
        {error && <p role="alert" className="notice error">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <>
            <h3>Last 90 days</h3>
            <div className="people-strip" role="img" aria-label="Activity over the last 90 days">
              {data.activity.map((a) => <i key={a.day} title={`${a.day}: ${a.n} events`} style={{ opacity: a.n ? 0.25 + 0.75 * (a.n / peak) : 0.08 }} />)}
            </div>
            {!user.hasUsage && <p className="muted">No usage events: this person turned analytics off, or has not used the app since. Sign-in records are shown below.</p>}
            <h3>Sessions</h3>
            {data.sessions.length ? data.sessions.map((s) => (
              <section key={s.id} className="people-session">
                <header>
                  <b>{date(s.start)}</b> <span className="muted">{time(s.start)}–{time(s.end)} · {platformLabel(s.platform)}{s.version ? ` ${s.version}` : ''}</span>
                </header>
                <ul>
                  {s.items.map((it, i) => <li key={i}><time className="num">{time(it.ts)}</time> {it.label}</li>)}
                </ul>
              </section>
            )) : <p className="muted">No events recorded.</p>}
            {data.truncated && <p className="muted">Showing the latest 500 events.</p>}
          </>
        )}
      </div>
    </>
  );
}
