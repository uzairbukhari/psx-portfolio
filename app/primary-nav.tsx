'use client';
import { Ellipsis } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NAV_ITEMS, TAB_PATHS, type NavItem } from './navigation';

/** Items shown directly on the compact mobile bar; everything else primary moves under "More". */
const MOBILE_DIRECT = 4;

export function visibleNav(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => item.primary && (!item.adminOnly || isAdmin));
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (id: string) => void;
}) {
  return (
    <a
      href={TAB_PATHS[item.id]}
      className="nav-link"
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onNavigate(item.id);
      }}
    >
      <span className="nav-label nav-label-full">{item.label}</span>
      <span className="nav-label nav-label-short">{item.shortLabel}</span>
    </a>
  );
}

/** Desktop: tab row under the header. Mobile: fixed bottom bar with a More menu. */
export function PrimaryNav({
  tab,
  isAdmin,
  onNavigate,
}: {
  tab: string;
  isAdmin: boolean;
  onNavigate: (id: string) => void;
}) {
  const items = visibleNav(isAdmin);
  const direct = items.slice(0, MOBILE_DIRECT);
  const overflow = items.slice(MOBILE_DIRECT);
  const moreActive = overflow.some((item) => item.id === tab) || tab === 'settings' || tab === 'notifications';
  return (
    <>
      <nav className="primary-nav primary-nav-desktop" aria-label="Primary">
        {items.map((item) => (
          <NavLink key={item.id} item={item} active={tab === item.id} onNavigate={onNavigate} />
        ))}
      </nav>
      <nav className="primary-nav primary-nav-mobile" aria-label="Primary (compact)">
        {direct.map((item) => (
          <NavLink key={item.id} item={item} active={tab === item.id} onNavigate={onNavigate} />
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            className={'nav-link nav-more' + (moreActive ? ' is-active' : '')}
            aria-label="More destinations"
          >
            <Ellipsis size={18} aria-hidden="true" />
            <span className="nav-label">More</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {overflow.map((item) => (
              <DropdownMenuItem key={item.id} onClick={() => onNavigate(item.id)}>
                {item.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onClick={() => onNavigate('notifications')}>Notifications</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNavigate('settings')}>Settings</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </>
  );
}
