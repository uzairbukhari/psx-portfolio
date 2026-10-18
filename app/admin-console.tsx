/* oxlint-disable next/no-html-link-for-pages -- full page loads are intended: next/link throws in the vinext production build */
'use client';

import { useState } from 'react';
import { Activity, ArrowLeft, BarChart3, Cloud, LayoutDashboard, ScrollText, Users } from 'lucide-react';
import { ADMIN_SECTIONS, type AdminSection } from './admin-sections';
import AdminAccounts from './admin-accounts';
import AdminOverview from './admin-overview';
import AdminPlatform from './admin-platform';
import AuditLog from './audit-log';
import SystemHealth from './system-health';
import UsageDashboard from './usage-dashboard';
import { UserAvatar } from './user-avatar';
import { Switch } from '@/components/ui/switch';
import { PillSwitch } from './insight-card';
import './dashboard-styles';
import './admin.css';
import './redesign-admin.css';

const ICONS = { overview: LayoutDashboard, health: Activity, platform: Cloud, analytics: BarChart3, audit: ScrollText, accounts: Users } as const;

/** Full-width super admin space, outside Settings and outside the vault gate (none of it needs the portfolio). */
export default function AdminConsole({ section, email, name, picture }: { section: AdminSection; email: string; name: string | null; picture: string | null }) {
  const [includeInternal, setIncludeInternal] = useState(false);
  const [days, setDays] = useState(30);
  const current = ADMIN_SECTIONS.find((s) => s.id === section)!;
  const showsRange = section === 'analytics' || section === 'audit';
  const showsToggle = section === 'overview' || section === 'analytics' || section === 'audit';

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
            onChange={(v) => setDays(Number(v))}
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
          {ADMIN_SECTIONS.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <a key={id} href={`/admin/${id}`} className={id === section ? 'active' : ''} aria-current={id === section ? 'page' : undefined}>
                <Icon size={16} aria-hidden="true" /> {label}
              </a>
            );
          })}
          <hr />
          <a href="/"><ArrowLeft size={16} aria-hidden="true" /> Back to app</a>
        </nav>
        <main className="admin-main">
          <h1>{current.label}</h1>
          <p className="muted">{current.description}</p>
          <div className="admin-card">
            {section === 'overview' && <AdminOverview includeInternal={includeInternal} />}
            {section === 'health' && <SystemHealth />}
            {section === 'platform' && <AdminPlatform />}
            {section === 'analytics' && <UsageDashboard includeInternal={includeInternal} days={days} />}
            {section === 'audit' && <AuditLog includeInternal={includeInternal} days={days} />}
            {section === 'accounts' && <AdminAccounts email={email} />}
          </div>
        </main>
      </div>
    </div>
  );
}
