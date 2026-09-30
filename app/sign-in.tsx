'use client';

import { useSyncExternalStore } from 'react';
import { BookOpenCheck, CalendarClock, Coins, Wallet } from 'lucide-react';
import './sign-in.css';

const SIGNIN_CANDLES: [number, number][] = [
  [18, 24],
  [24, 21],
  [21, 30],
  [30, 27],
  [27, 36],
  [36, 43],
  [43, 39],
  [39, 49],
  [49, 56],
  [56, 51],
  [51, 61],
  [61, 68],
  [68, 63],
  [63, 72],
  [72, 80],
  [80, 88],
];
function SignInChart() {
  const width = 640,
    height = 220,
    gap = width / SIGNIN_CANDLES.length;
  const scale = (v: number) => height - 20 - v * 1.9;
  return (
    <svg
      className="signin-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {SIGNIN_CANDLES.map(([open, close], i) => {
        const x = i * gap + gap / 2;
        const up = close >= open;
        const color = up ? '#22e0a0' : '#ff5d6c';
        const bodyTop = scale(Math.max(open, close));
        const bodyBottom = scale(Math.min(open, close));
        return (
          <g key={i} stroke={color} fill={color}>
            <line
              x1={x}
              x2={x}
              y1={scale(Math.max(open, close) + 4)}
              y2={scale(Math.min(open, close) - 4)}
              strokeWidth={1.5}
            />
            <rect
              x={x - gap * 0.28}
              y={bodyTop}
              width={gap * 0.56}
              height={Math.max(bodyBottom - bodyTop, 2)}
            />
          </g>
        );
      })}
    </svg>
  );
}
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}


const ERROR_COPY: Record<string, string> = {
  oauth_email:
    "That Google account isn't allowed here, or its email isn't verified. Try a different account.",
  oauth_state: 'Sign-in was interrupted. Try again.',
  oauth_token: 'Sign-in was interrupted. Try again.',
  oauth_userinfo: 'Google did not return your profile. Try again.',
  oauth_config: 'Sign-in is not configured on this server yet.',
};

const POINTS = [
  {
    icon: BookOpenCheck,
    title: 'A ledger you can trust',
    body: 'Every purchase, sale and fee, with cost basis worked out for you.',
  },
  {
    icon: CalendarClock,
    title: 'A monthly SIP plan',
    body: 'Picks and allocations sized to what you plan to invest each month.',
  },
  {
    icon: Coins,
    title: 'Dividends tracked automatically',
    body: 'PSX payout announcements are booked against the shares you held.',
  },
];

function Brand() {
  return (
    <div className="brand">
      <Wallet size={24} />
      <span>PSX / PERSONAL INVESTING</span>
    </div>
  );
}

export function SignIn({ returnTo }: { returnTo: string }) {
  const errorCode = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get('error') ?? '',
    () => '',
  );
  const error = errorCode
    ? (ERROR_COPY[errorCode] ?? 'Sign-in failed. Try again.')
    : '';
  return (
    <main className="signin">
      <section className="signin-hero">
        <Brand />
        <div className="signin-hero-copy">
          <h1>Every rupee you&rsquo;ve put into PSX, in one ledger.</h1>
          <p>
            Track what you own, plan what to buy next, and see what it has
            earned you.
          </p>
          <ul className="signin-points">
            {POINTS.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon size={18} aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <span>{body}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <SignInChart />
      </section>
      <section className="signin-panel">
        <div className="signin-card">
          <span className="signin-mark">
            <Wallet size={22} />
          </span>
          <h2>Sign in to PSX Portfolio</h2>
          <p className="muted">
            Use your Google account. Your holdings stay private to it.
          </p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <a
            className="google-btn"
            href={`/api/auth/google/login?return_to=${encodeURIComponent(returnTo)}`}
            target="_top"
          >
            <GoogleMark /> Continue with Google
          </a>
          <small className="signin-foot">
            No orders are placed from this app, and nothing is shared.
          </small>
        </div>
      </section>
    </main>
  );
}

export function LoadError({
  message,
  busy,
  onRetry,
}: {
  message: string;
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <main className="load-error">
      <div className="signin-card">
        <span className="signin-mark">
          <Wallet size={22} />
        </span>
        <h2>We couldn&rsquo;t load your portfolio</h2>
        <p role="alert" className="notice error">
          {message}
        </p>
        <button disabled={busy} onClick={onRetry}>
          Try again
        </button>
        <button
          type="button"
          className="signin-link"
          onClick={() => {
            window.location.href = '/api/auth/logout';
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
