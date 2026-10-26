/* oxlint-disable next/no-html-link-for-pages -- full page loads are intended: next/link throws in the vinext production build */
'use client';

import { Fragment, useEffect, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, Cloud, Gauge, LayoutDashboard, Megaphone, MessageSquareText, Repeat2, Route, ScrollText, Sparkles, UserSearch, Users } from 'lucide-react';
import { ADMIN_SECTIONS, isLensSection, type AdminSection } from './admin-sections';
import AdminAnalytics from './admin-analytics';
import { writeUrl } from './admin-analytics-kit';
import AdminAccounts from './admin-accounts';
import AdminOverview from './admin-overview';
import AdminUsers from './admin-users';
import AdminPlatform from './admin-platform';
import AuditLog from './audit-log';
import AdminFeedback from './admin-feedback';
import SystemHealth from './system-health';
import UsageDashboard from './usage-dashboard';
import { UserAvatar } from './user-avatar';
import { Switch } from '@/components/ui/switch';
import { PillSwitch } from './insight-card';
import './dashboard-styles';
import './admin.css';
import './redesign-admin.css';
import './feedback.css';

const ICONS = { overview: LayoutDashboard, health: Activity, platform: Cloud, pulse: Sparkles, journeys: Route, engagement: Repeat2, acquisition: Megaphone, quality: Gauge, analytics: BarChart3, audit: ScrollText, users: UserSearch, feedback: MessageSquareText, accounts: Users } as const;

/** Full-width super admin space, outside Settings and outside the vault gate (none of it needs the portfolio). */
export default function AdminConsole({ section, email, name, picture }: { section: AdminSection; email: string; name: string | null; picture: string | null }) {
  const [includeInternal, setIncludeInternal] = useState(false);
  const [days, setDays] = useState(30);
  const [urlRead, setUrlRead] = useState(false);
  // A shared link can carry the range; read after mount so the server and the first client render agree, and only
  // then mount the lens so it does not load the default range first.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const d = Number(new URLSearchParams(window.location.search).get('days'));
      if ([7, 30, 90].includes(d)) setDays(d);
      setUrlRead(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const current = ADMIN_SECTIONS.find((s) => s.id === section)!;
  const lens = isLensSection(section);
  const showsRange = lens || section === 'analytics' || section === 'audit';
  const showsToggle = lens || section === 'overview' || section === 'analytics' || section === 'audit' || section === 'users';
  useGoShortcuts();

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <strong>Sipwise</strong>
        <span className="admin-sep" aria-hidden="true">/</span>
        <span>Admin console</span>
        <span className="admin-grow" />
        {showsRange && (
          <PillSwitch
            label="Time range"
            value={String(days)}
            onChange={(v) => {
              setDays(Number(v));
              writeUrl({ days: v === '30' ? null : v });
            }}
            options={[7, 30, 90].map((d) => ({ key: String(d), label: `${d} days` }))}
          />
        )}
        {showsToggle && (
          <label className="admin-switch">
            <Switch checked={includeInternal} onCheckedChange={setIncludeInternal} aria-label="Include internal accounts" /> Include internal accounts
          </label>
        )}
        <UserAvatar name={name} email={email} picture={picture} />
      </header>
      <div className="admin-body">
        <nav className="admin-nav" aria-label="Admin sections">
          {/* Plain anchors: next/link throws in the vinext production build, so navigation is a full page load. */}
          {ADMIN_SECTIONS.map((s, i) => {
            const { id, label } = s;
            const Icon = ICONS[id];
            const group = 'group' in s ? s.group : null;
            const prev = ADMIN_SECTIONS[i - 1];
            const starts = group && !(prev && 'group' in prev && prev.group === group);
            return (
              <Fragment key={id}>
                {starts && <span className="admin-nav__group">{group}</span>}
                <a href={`/admin/${id}`} className={id === section ? 'active' : ''} aria-current={id === section ? 'page' : undefined}>
                  <Icon size={16} aria-hidden="true" /> {label}
                </a>
              </Fragment>
            );
          })}
          <hr />
          <a href="/"><ArrowLeft size={16} aria-hidden="true" /> Back to app</a>
        </nav>
        <main className="admin-main">
          <h1>{current.label}</h1>
          <p className="muted">{current.description}</p>
          <div className={lens ? 'admin-card admin-card--flat' : 'admin-card'}>
            {lens && urlRead && <AdminAnalytics section={section} days={days} includeInternal={includeInternal} />}
            {section === 'overview' && <AdminOverview includeInternal={includeInternal} />}
            {section === 'health' && <SystemHealth />}
            {section === 'platform' && <AdminPlatform />}
            {section === 'analytics' && <UsageDashboard includeInternal={includeInternal} days={days} />}
            {section === 'audit' && <AuditLog includeInternal={includeInternal} days={days} />}
            {section === 'users' && <AdminUsers includeInternal={includeInternal} />}
            {section === 'feedback' && <AdminFeedback />}
            {section === 'accounts' && <AdminAccounts email={email} />}
          </div>
        </main>
      </div>
    </div>
  );
}

const GO_KEYS: Record<string, string> = { s: 'pulse', j: 'journeys', e: 'engagement', a: 'acquisition', q: 'quality', p: 'users', o: 'overview' };

/** `g` then a letter jumps to a section (s summary, j journeys, e engagement, a acquisition, q quality, p people, o overview). */
function useGoShortcuts() {
  useEffect(() => {
    let armed = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest('input, textarea, select, [contenteditable=true]')) return;
      if (e.key === 'g') {
        armed = Date.now();
        return;
      }
      if (armed && Date.now() - armed < 1200 && GO_KEYS[e.key]) {
        const keep = new URLSearchParams(window.location.search);
        const shared = ['days', 'platform', 'segment'].filter((k) => keep.has(k)).map((k) => `${k}=${keep.get(k)}`).join('&');
        window.location.href = `/admin/${GO_KEYS[e.key]}${shared ? `?${shared}` : ''}`;
      }
      armed = 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
