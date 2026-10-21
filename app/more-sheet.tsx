'use client';
// The phone's "More" sheet: the pages that do not fit in the bottom bar, plus Settings, Help, Theme and the account
// actions that live in the profile menu on desktop.
import { LifeBuoy, LockKeyhole, LogOut, Settings, ShieldCheck } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { parseThemePreference, THEMES } from '@/lib/theme';
import type { NavItem } from './app-nav';
import { useTheme } from './use-theme';
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
  const { preference, setPreference } = useTheme();
  const close = () => onOpenChange(false);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="more-sheet" showCloseButton={false}>
        <SheetHeader className="more-head">
          <UserAvatar name={name} email={email} picture={picture} large />
          <div>
            <SheetTitle className="more-name">{name || email}</SheetTitle>
            <SheetDescription>{unlocked ? 'Vault unlocked' : 'Signed in'}</SheetDescription>
          </div>
        </SheetHeader>
        {items.length > 0 && (
          <nav className="more-group" aria-label="More pages">
            <p className="lbl">Pages</p>
            {items.map((i) => (
              <a
                key={i.tab}
                href={i.href}
                className="more-row"
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
          </nav>
        )}
        <div className="more-group">
          <p className="lbl">Account</p>
          <button type="button" data-slot="more-row" className="more-row" onClick={run(onSettings)}>
            <Settings aria-hidden="true" /> <span>Settings</span>
          </button>
          <button type="button" data-slot="more-row" className="more-row" onClick={run(onHelp)}>
            <LifeBuoy aria-hidden="true" /> <span>Help</span>
          </button>
          {onAdmin && (
            <button type="button" data-slot="more-row" className="more-row" onClick={run(onAdmin)}>
              <ShieldCheck aria-hidden="true" /> <span>Admin console</span>
            </button>
          )}
          {onLock && (
            <button type="button" data-slot="more-row" className="more-row" onClick={run(onLock)}>
              <LockKeyhole aria-hidden="true" /> <span>Lock vault</span>
            </button>
          )}
        </div>
        <div className="more-group">
          <p className="lbl" id="more-theme">
            Theme
          </p>
          <div className="sw-seg more-theme" aria-labelledby="more-theme">
            {[...THEMES.map((t) => ({ id: t.id as string, label: t.label })), { id: 'system', label: 'System' }].map((t) => (
              <button
                key={t.id}
                type="button"
                data-slot="seg"
                aria-pressed={preference === t.id}
                onClick={() => setPreference(parseThemePreference(t.id))}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" data-slot="more-row" className="more-row more-signout" onClick={run(onSignOut)}>
          <LogOut aria-hidden="true" /> <span>Sign out</span>
        </button>
      </SheetContent>
    </Sheet>
  );
}
