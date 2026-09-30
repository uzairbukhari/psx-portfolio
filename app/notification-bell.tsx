'use client';
import { useState } from 'react';
import { Bell } from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { pktDateTime } from '@/lib/format';
import type { AppNotification } from '@/lib/portfolio';

export function NotificationBell({
  notifications,
  busy,
  onChange,
  onViewAll,
}: {
  /** Notifications that have not been cleared. */
  notifications: AppNotification[];
  busy: boolean;
  onChange: (change: (list: AppNotification[]) => AppNotification[]) => void;
  onViewAll: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;
  return (
    <>
      <Popover>
        <PopoverTrigger
          className="bell-trigger hdr-btn"
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
        >
          <Bell size={18} aria-hidden="true" />
          <span className="hdr-label">Notifications</span>
          {unreadCount > 0 && (
            <span className="bell-badge" aria-hidden="true">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="notice-panel">
          <div className="notice-head">
            <strong>Notifications</strong>
            <span className="row">
              <button
                type="button"
                data-slot="link"
                className="link-button"
                disabled={busy || !unreadCount}
                onClick={() =>
                  onChange((list) => list.map((n) => ({ ...n, read: true })))
                }
              >
                Mark all read
              </button>
              <button
                type="button"
                data-slot="link"
                className="link-button"
                disabled={busy || !notifications.length}
                onClick={() => setConfirmClear(true)}
              >
                Clear
              </button>
            </span>
          </div>
          {notifications.length === 0 ? (
            <p className="muted notice-empty">
              Nothing yet. Dividends recorded from PSX announcements and new
              payout announcements for your holdings appear here.
            </p>
          ) : (
            <ul className="notice-list">
              {notifications.map((n) => (
                <li key={n.id} className={n.read ? '' : 'unread'}>
                  <button
                    type="button"
                    data-slot="link"
                    className="notice-item"
                    onClick={() => {
                      if (!n.read)
                        onChange((list) =>
                          list.map((x) =>
                            x.id === n.id ? { ...x, read: true } : x,
                          ),
                        );
                    }}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    <small>{pktDateTime(n.at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="notice-foot">
            <button
              type="button"
              data-slot="link"
              className="link-button"
              onClick={onViewAll}
            >
              View all notifications
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              They leave this list but stay in your notification history, where
              you can review them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const at = new Date().toISOString();
                onChange((list) =>
                  list.map((n) =>
                    n.clearedAt ? n : { ...n, read: true, clearedAt: at },
                  ),
                );
                setConfirmClear(false);
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
