import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Reports | Sipwise',
  description: 'Portfolio performance and allocation reports.',
};
export default function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/reports" searchParams={searchParams} />;
}
