import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Activity | Sipwise',
  description: 'Every buy, sale, dividend and split, newest first.',
};
export default function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/activity" searchParams={searchParams} />;
}
