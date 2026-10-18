import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Plan | Sipwise',
  description: 'This month’s fresh money, your shortlist and the latest picks.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/plan" searchParams={searchParams} />;
}
