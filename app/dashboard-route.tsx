// Server Component shared by every app route (/, /reports, /activity, /company/[ticker], ...).
// Signed out: the static landing (no client bundle). Signed in: the client dashboard.
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import Dashboard from './portfolio';
import { CfBeacon } from './cf-beacon';
import { LandingPage } from './landing-page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function DashboardRoute({
  returnTo,
  searchParams,
  adminOnly = false,
  signedOutView,
}: {
  returnTo: string;
  searchParams?: SearchParams;
  adminOnly?: boolean;
  /** Shown instead of the landing page to signed-out visitors (public pages such as /feedback). */
  signedOutView?: ReactNode;
}) {
  const user = await getViewer();
  if (!user) {
    if (signedOutView) return signedOutView;
    const error = (await searchParams)?.error;
    return (
      <>
        <CfBeacon />
        <LandingPage
          returnTo={returnTo}
          errorCode={typeof error === 'string' ? error : undefined}
        />
      </>
    );
  }
  if (adminOnly && user.role !== 'super_admin') redirect('/');
  return (
    <Dashboard
      email={user.email}
      name={user.name ?? null}
      picture={user.picture ?? null}
      role={user.role}
    />
  );
}
