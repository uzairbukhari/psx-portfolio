import type { ReactNode } from 'react';
import { signInHref, type HostConfig, type SignupSource } from '@/lib/hosts';

export function Icon({ name, size = 16 }: { name: 'check' | 'lock' | 'play' | 'shield' | 'eye' | 'link'; size?: number }) {
  const common = { width: size, height: size, 'aria-hidden': true as const, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'check': return <svg viewBox="0 0 16 16" {...common}><path d="M3 8.5l3 3 7-7" /></svg>;
    case 'lock': return <svg viewBox="0 0 24 24" {...common}><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'play': return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>;
    case 'shield': return <svg viewBox="0 0 24 24" {...common}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>;
    case 'eye': return <svg viewBox="0 0 24 24" {...common}><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.2M6.1 7.9C4.2 9.4 3 12 3 12s4 6 9 6c1.3 0 2.5-.3 3.6-.8" /></svg>;
    case 'link': return <svg viewBox="0 0 24 24" {...common}><path d="M9 15l6-6M8 12l-2 2a3.5 3.5 0 0 0 5 5l2-2M16 12l2-2a3.5 3.5 0 0 0-5-5l-2 2M3 3l18 18" /></svg>;
  }
}

function GoogleMark() {
  return (
    <svg className="m-gicon" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Every Google button on the site: goes to the app host's sign-in with a closed-list `src` for the funnel. */
export function GoogleCta({ cfg, src, children, small = false, style }: { cfg: HostConfig; src: SignupSource; children: ReactNode; small?: boolean; style?: React.CSSProperties }) {
  return (
    <a className={`m-btn m-btn-google${small ? ' m-btn-sm' : ''}`} href={signInHref(cfg, src)} style={style}>
      <GoogleMark />
      {children}
    </a>
  );
}

/** Decorative drawing area (screen readers skip it; the text next to it says the same). */
export function Svg({ viewBox, inner, className, draw = false, style }: { viewBox: string; inner: string; className?: string; draw?: boolean; style?: React.CSSProperties }) {
  return <svg viewBox={viewBox} className={className} style={style} aria-hidden="true" data-draw={draw ? '' : undefined} dangerouslySetInnerHTML={{ __html: inner }} />;
}

/** Hidden gradients the inline charts refer to. */
export function Defs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="mk-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2EE6A6" stopOpacity=".35" /><stop offset="1" stopColor="#2EE6A6" stopOpacity="0" /></linearGradient>
        <linearGradient id="mk-area-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6EA2FF" stopOpacity=".45" /><stop offset="1" stopColor="#6EA2FF" stopOpacity=".02" /></linearGradient>
      </defs>
    </svg>
  );
}
