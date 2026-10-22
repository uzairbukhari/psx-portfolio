'use client';
// The profile card at the bottom of the sidebar and the menu it opens. The menu opens to the right of the sidebar, in
// the same place whether the sidebar is open or collapsed, and closes when the sidebar changes width so it never has
// to follow a moving anchor.
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronsUpDown, ExternalLink, LifeBuoy, LockKeyhole, LogOut, MessageSquareText, Settings, ShieldCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ThemeSwatches } from './theme-menu';
import { UserAvatar } from './user-avatar';

export function AccountMenu({
  name,
  email,
  picture,
  isAdmin,
  unlocked,
  sideMode,
  onSettings,
  onHelp,
  onFeedback,
  onAdmin,
  onLock,
  onSignOut,
}: {
  name: string | null;
  email: string;
  picture: string | null;
  isAdmin: boolean;
  unlocked: boolean;
  /** Changes whenever the sidebar opens or collapses. */
  sideMode: string;
  onSettings: () => void;
  onHelp: () => void;
  onFeedback: () => void;
  onAdmin?: () => void;
  onLock?: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const themeLabel = useId();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOpen(false);
  }, [sideMode]);
  const status = unlocked ? 'Vault unlocked' : 'Signed in';
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="account-trigger acct-card" title={`${name || email} · ${status}`}>
        <span className="acct-av">
          <UserAvatar name={name} email={email} picture={picture} />
          {unlocked && <i className="acct-dot" aria-hidden="true" />}
        </span>
        <span className="account-who">
          <b>{name || email}</b>
          <small>{status}</small>
        </span>
        <ChevronsUpDown size={16} className="account-chevron" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={16} className="account-menu">
        <div className="account-menu-header">
          <span className="acct-av">
            <UserAvatar name={name} email={email} picture={picture} large />
            {unlocked && <i className="acct-dot" aria-hidden="true" />}
          </span>
          <div>
            {name && <span className="account-menu-name">{name}</span>}
            <span className="account-menu-email" title={email}>
              {email}
            </span>
          </div>
        </div>
        <div className="acct-chips">
          <span className="acct-chip" data-ok={unlocked || undefined}>
            {unlocked && <i aria-hidden="true" />}
            {status}
          </span>
          {isAdmin && <span className="acct-chip">Super admin</span>}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSettings}>
          <Settings size={16} /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onHelp}>
          <LifeBuoy size={16} /> Help and tour
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFeedback}>
          <MessageSquareText size={16} /> Contact and feedback
        </DropdownMenuItem>
        {onAdmin && (
          <DropdownMenuItem onClick={onAdmin}>
            <ShieldCheck size={16} /> Admin console
            <ExternalLink size={14} className="acct-ext" aria-hidden="true" />
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <div className="acct-theme">
          <p id={themeLabel}>Theme</p>
          <ThemeSwatches labelledBy={themeLabel} />
        </div>
        <DropdownMenuSeparator />
        {onLock && (
          <DropdownMenuItem onClick={onLock}>
            <LockKeyhole size={16} /> Lock vault
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="acct-signout" onClick={onSignOut}>
          <LogOut size={16} /> Sign out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="acct-legal">
          <a href="/privacy">Privacy</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">Terms</a>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
