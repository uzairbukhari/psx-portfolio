'use client';

import { useState } from 'react';
import { ArrowLeft, Bell, CheckCheck, Coins, Megaphone, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { AppNotification } from '@/lib/portfolio';
import { TickerLink } from './ticker-link';

type Filter = 'all' | 'unread' | 'cleared';

const KIND_ICON: Record<AppNotification['kind'], typeof Bell> = {
  'dividend-recorded': Coins,
  'dividend-replaced': RefreshCw,
  'payout-announced': Megaphone,
  info: Bell,
};

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(day)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return day.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: day.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export default function NotificationsView({
  notifications,
  busy,
  onChange,
  onBack,
}: {
  notifications: AppNotification[];
  busy: boolean;
  onChange: (change: (list: AppNotification[]) => AppNotification[]) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const counts = {
    all: notifications.length,
    unread: notifications.filter((n) => !n.read && !n.clearedAt).length,
    cleared: notifications.filter((n) => n.clearedAt).length,
  };
  const shown = notifications
    .filter((n) =>
      filter === 'unread' ? !n.read && !n.clearedAt : filter === 'cleared' ? !!n.clearedAt : true,
    )
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const groups: { label: string; items: AppNotification[] }[] = [];
  for (const n of shown) {
    const label = dayLabel(n.at);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(n);
    else groups.push({ label, items: [n] });
  }
  const patch = (id: string, change: Partial<AppNotification>) =>
    onChange((list) => list.map((n) => (n.id === id ? { ...n, ...change } : n)));

  return (
    <div className="notif-page">
      <button type="button" data-slot="link" className="back-link" onClick={onBack}>
        <ArrowLeft size={15} /> Back to dashboard
      </button>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>Everything from your portfolio, including what you cleared from the bell.</p>
        </div>
        <div className="row">
          <button
            className="secondary compact"
            disabled={busy || !counts.unread}
            onClick={() =>
              onChange((list) => list.map((n) => (n.clearedAt ? n : { ...n, read: true })))
            }
          >
            <CheckCheck size={14} /> Mark all read
          </button>
          <button
            className="secondary compact"
            disabled={busy || !counts.cleared}
            onClick={() => setConfirmDelete(true)}
          >
            Delete cleared
          </button>
        </div>
      </div>
      <div className="filter-chips" role="tablist" aria-label="Filter notifications">
        {(['all', 'unread', 'cleared'] as const).map((f) => (
          <button
            key={f}
            type="button"
            data-slot="chip"
            role="tab"
            aria-selected={filter === f}
            className={filter === f ? 'chip active' : 'chip'}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Cleared'}
            <span>{counts[f]}</span>
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <section className="panel notif-empty">
          <Bell size={22} aria-hidden="true" />
          <strong>
            {filter === 'cleared'
              ? 'Nothing cleared yet'
              : filter === 'unread'
                ? "You're all caught up"
                : 'No notifications yet'}
          </strong>
          <p>
            {filter === 'cleared'
              ? 'Notifications you clear from the bell are kept here.'
              : 'Dividends recorded from PSX announcements and new payout news for your holdings appear here.'}
          </p>
        </section>
      ) : (
        groups.map((g) => (
          <section key={g.label} className="notif-group">
            <h2>{g.label}</h2>
            <ul className="panel notif-list">
              {g.items.map((n) => {
                const Icon = KIND_ICON[n.kind];
                return (
                  <li key={n.id} className={!n.read && !n.clearedAt ? 'unread' : ''}>
                    <span className="notif-icon">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <div className="notif-body">
                      <strong>
                        {n.title}
                        {n.clearedAt && <em className="notif-badge">Cleared</em>}
                      </strong>
                      <span>{n.body}</span>
                      <small>
                        {n.ticker && (
                          <>
                            <TickerLink ticker={n.ticker} /> ·{' '}
                          </>
                        )}
                        {new Date(n.at).toLocaleString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                          day: 'numeric',
                          month: 'short',
                        })}
                      </small>
                    </div>
                    <div className="notif-actions">
                      {n.clearedAt ? (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => patch(n.id, { clearedAt: undefined })}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          className="secondary compact"
                          disabled={busy}
                          onClick={() => patch(n.id, { read: !n.read })}
                        >
                          Mark {n.read ? 'unread' : 'read'}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete cleared notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              {counts.cleared} cleared notification{counts.cleared === 1 ? '' : 's'} will be
              removed for good. This can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => onChange((list) => list.filter((n) => !n.clearedAt))}
            >
              Delete cleared
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
