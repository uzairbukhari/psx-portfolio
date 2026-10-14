import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Activity | Sipwise',
  description: 'Full ledger of recorded trades and corrections.',
};
export default function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/history" searchParams={searchParams} />;
}
