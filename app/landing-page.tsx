// Server Component: no 'use client'. Signed-out visitors download none of the dashboard code.
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

export function LandingPage({
  returnTo,
  errorCode,
}: {
  returnTo: string;
  errorCode?: string;
}) {
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
