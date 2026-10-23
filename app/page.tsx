import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/marketing-seo';
import { currentHostRole } from '@/lib/hosts-server';
import { DashboardRoute } from './dashboard-route';
import { MarketingHome } from './marketing/home';

// The app host is not for search engines (robots.txt also says so); every other host carries the marketing metadata.
export async function generateMetadata(): Promise<Metadata> {
  if ((await currentHostRole()) === 'app') return { robots: { index: false, follow: false } };
  return pageMetadata('home');
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const role = await currentHostRole();
  // The marketing host never looks at a session: it reads nothing from the database.
  if (role === 'marketing') return <MarketingHome />;
  // One host (local, sandbox, staging): signed-out visitors see the marketing home, apart from a failed sign-in, which
  // keeps the sign-in page so the error is shown.
  const failed = typeof (await searchParams).error === 'string';
  return (
    <DashboardRoute
      returnTo="/"
      searchParams={searchParams}
      signedOutView={role === 'single' && !failed ? <MarketingHome /> : undefined}
    />
  );
}
