'use client';

import { useSyncExternalStore } from 'react';
import { LogoMark } from '@/components/logo';
import { LandingFooter, LandingNav } from './landing/landing-chrome';
import { Hero } from './landing/hero';
import {
  AssetsSection,
  DevicesSection,
  FinalCta,
  PlanSection,
  PrivacySection,
} from './landing/sections';
import './landing.css';

const ERROR_COPY: Record<string, string> = {
  oauth_email:
    "That Google account isn't allowed here, or its email isn't verified. Try a different account.",
  oauth_state:
    'Your sign-in session expired or was opened in a different browser. Please try again.',
  oauth_token: 'Google sign-in was interrupted. Please try again.',
  oauth_userinfo: 'Google did not return your profile. Please try again.',
  oauth_denied: 'Sign-in was cancelled. You can try again whenever you like.',
  oauth_failed: 'Something went wrong while signing you in. Please try again.',
  oauth_config: 'Sign-in is not configured on this server yet.',
};

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
    <main className="landing">
      <LandingNav returnTo={returnTo} onLanding />
      <Hero returnTo={returnTo} error={error} />
      <AssetsSection />
      <PlanSection />
      <PrivacySection />
      <DevicesSection />
      <FinalCta returnTo={returnTo} />
      <LandingFooter />
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
