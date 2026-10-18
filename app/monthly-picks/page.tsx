import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Monthly Picks | Sipwise',
  description: 'Sourced 60–90 day research for your PSX shortlist.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/monthly-picks" searchParams={searchParams} />;
}
