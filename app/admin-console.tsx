'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, BarChart3, ScrollText, Users } from 'lucide-react';
import { ADMIN_SECTIONS, type AdminSection } from './admin-sections';
import AdminAccounts from './admin-accounts';
import AuditLog from './audit-log';
import SystemHealth from './system-health';
import UsageDashboard from './usage-dashboard';
import { UserAvatar } from './user-avatar';
import './admin.css';

const ICONS = { health: Activity, analytics: BarChart3, audit: ScrollText, accounts: Users } as const;

/** Full-width super admin space, outside Settings and outside the vault gate (none of it needs the portfolio). */
export default function AdminConsole({ section, email, name, picture }: { section: AdminSection; email: string; name: string | null; picture: string | null }) {
  const [includeInternal, setIncludeInternal] = useState(false);
  const current = ADMIN_SECTIONS.find((s) => s.id === section)!;
  const showsToggle = section === 'analytics' || section === 'audit';

  return (
    <div className="admin-shell">
      <header className="admin-top">
        <strong>Sipwise</strong>
        <span className="admin-sep" aria-hidden="true">/</span>
        <span>Admin console</span>
        <span className="admin-grow" />
        {showsToggle && (
          <label className="admin-switch">
            <input type="checkbox" checked={includeInternal} onChange={(e) => setIncludeInternal(e.target.checked)} /> Include internal accounts
          </label>
        )}
        <UserAvatar name={name} email={email} picture={picture} />
      </header>
      <div className="admin-body">
        <nav className="admin-nav" aria-label="Admin sections">
          {ADMIN_SECTIONS.map(({ id, label }) => {
            const Icon = ICONS[id];
            return (
              <Link key={id} href={`/admin/${id}`} className={id === section ? 'active' : ''} aria-current={id === section ? 'page' : undefined}>
                <Icon size={16} aria-hidden="true" /> {label}
              </Link>
            );
          })}
          <hr />
          <Link href="/"><ArrowLeft size={16} aria-hidden="true" /> Back to app</Link>
        </nav>
        <main className="admin-main">
          <h1>{current.label}</h1>
          <p className="muted">{current.description}</p>
          <div className="admin-card">
            {section === 'health' && <SystemHealth />}
            {section === 'analytics' && <UsageDashboard includeInternal={includeInternal} />}
            {section === 'audit' && <AuditLog includeInternal={includeInternal} />}
            {section === 'accounts' && <AdminAccounts email={email} />}
          </div>
        </main>
      </div>
    </div>
  );
}
