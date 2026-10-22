'use client';
// The phone's "More" sheet: the pages that do not fit in the bottom bar, plus Settings, Help, Theme and the account
// actions that live in the profile menu on desktop.
import { LifeBuoy, LockKeyhole, LogOut, Settings, ShieldCheck } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { NavItem } from './app-nav';
import { ThemeSwatches } from './theme-menu';
import { UserAvatar } from './user-avatar';

export function MoreSheet({
  open,
  onOpenChange,
  items,
  active,
  onNavigate,
  onSettings,
  onHelp,
  onLock,
  onSignOut,
  onAdmin,
  name,
  email,
  picture,
  unlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pages left out of the bottom bar. */
  items: NavItem[];
  active: string;
  onNavigate: (tab: string) => void;
  onSettings: () => void;
  onHelp: () => void;
  onLock?: () => void;
  onSignOut: () => void;
  /** Only for a super admin. */
  onAdmin?: () => void;
  name: string | null;
  email: string;
  picture: string | null;
  unlocked: boolean;
}) {
  const close = () => onOpenChange(false);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="more-sheet" showCloseButton={false}>
        <SheetHeader className="more-head">
          <span className="acct-av">
            <UserAvatar name={name} email={email} picture={picture} large />
            {unlocked && <i className="acct-dot" aria-hidden="true" />}
          </span>
          <div>
            <SheetTitle className="more-name">{name || email}</SheetTitle>
            <SheetDescription>{email}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="acct-chips more-chips">
          <span className="acct-chip" data-ok={unlocked || undefined}>
            {unlocked && <i aria-hidden="true" />}
            {unlocked ? 'Vault unlocked' : 'Signed in'}
          </span>
          {onAdmin && <span className="acct-chip">Super admin</span>}
        </div>
        {(items.length > 0 || onAdmin) && (
          <nav className="more-group" aria-label="More pages">
            <p className="lbl">More pages</p>
            <div className="more-tiles">
              {items.map((i) => (
                <a
                  key={i.tab}
                  href={i.href}
                  className="more-tile"
                  aria-current={i.tab === active ? 'page' : undefined}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    run(() => onNavigate(i.tab))();
                  }}
                >
                  {i.icon}
                  <span>{i.label}</span>
                  {i.badge && <span className="nav-badge more-badge">{i.badge}</span>}
                </a>
              ))}
              {onAdmin && (
                <button type="button" data-slot="more-tile" className="more-tile" onClick={run(onAdmin)}>
                  <ShieldCheck aria-hidden="true" /> <span>Admin console</span>
                </button>
              )}
            </div>
          </nav>
        )}
        <div className="more-group">
          <p className="lbl">Account</p>
          <button type="button" data-slot="more-row" className="more-row" onClick={run(onSettings)}>
            <Settings aria-hidden="true" /> <span>Settings</span>
          </button>
          <button type="button" data-slot="more-row" className="more-row" onClick={run(onHelp)}>
            <LifeBuoy aria-hidden="true" /> <span>Help and tour</span>
          </button>
        </div>
        <div className="more-group">
          <p className="lbl" id="more-theme">
            Theme
          </p>
          <ThemeSwatches labelledBy="more-theme" />
        </div>
        <div className="more-actions">
          {onLock && (
            <button type="button" data-slot="more-action" className="more-action" data-primary="" onClick={run(onLock)}>
              <LockKeyhole aria-hidden="true" /> Lock vault
            </button>
          )}
          <button type="button" data-slot="more-action" className="more-action" onClick={run(onSignOut)}>
            <LogOut aria-hidden="true" /> Sign out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
