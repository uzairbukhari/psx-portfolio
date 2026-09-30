'use client';
import Link from 'next/link';
import { ChevronDown, LogOut, RefreshCw, Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AppNotification } from '@/lib/portfolio';
import { AddTransactionMenu } from './add-transaction-menu';
import { Brand } from './brand';
import { NotificationBell } from './notification-bell';
import { usePortfolioContext } from './portfolio-context';
import { UserAvatar } from './user-avatar';

export function AppHeader({
  email,
  name,
  picture,
  companyTicker,
  notifications,
  onNotifications,
}: {
  email: string | null;
  name: string | null;
  picture: string | null;
  /** Prefills Add transaction while a company page is open. */
  companyTicker: string;
  notifications: AppNotification[];
  onNotifications: (
    change: (list: AppNotification[]) => AppNotification[],
  ) => void;
}) {
  const { busy, refreshing, goTab, refreshPrices } = usePortfolioContext();
  return (
    <header className="app-header">
      <Link
        href="/"
        className="brand-link"
        aria-label="FolioRaah — Overview"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          goTab('holdings');
        }}
      >
        <Brand />
      </Link>
      <div className="header-right">
        <button
          type="button"
          data-slot="hdr"
          className="hdr-btn"
          disabled={busy}
          aria-label="Refresh PSX prices"
          onClick={() => void refreshPrices()}
        >
          <RefreshCw size={18} aria-hidden="true" className={refreshing ? 'spin' : undefined} />
          <span className="hdr-label">{refreshing ? 'Refreshing…' : 'Refresh prices'}</span>
        </button>
        <AddTransactionMenu ticker={companyTicker || undefined} />
        <NotificationBell
          notifications={notifications.filter((n) => !n.clearedAt)}
          busy={busy}
          onChange={onNotifications}
          onViewAll={() => goTab('notifications')}
        />
        {email && (
          <DropdownMenu>
            <DropdownMenuTrigger className="account-trigger" aria-label="Account menu">
              <UserAvatar name={name} email={email} picture={picture} />
              <ChevronDown size={14} className="account-chevron" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="account-menu">
              <div className="account-menu-header">
                <UserAvatar name={name} email={email} picture={picture} large />
                <div>
                  {name && <span className="account-menu-name">{name}</span>}
                  <span className="account-menu-email">{email}</span>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => goTab('settings')}>
                <Settings size={15} aria-hidden="true" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  window.location.href = '/api/auth/logout';
                }}
              >
                <LogOut size={15} aria-hidden="true" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
