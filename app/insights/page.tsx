import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Insights | Sipwise',
  description: 'Charts and reports for your whole portfolio.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/insights" searchParams={searchParams} />;
}
