'use client';

import { LogoMark } from '@/components/logo';

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
        <LogoMark size={44} />
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
