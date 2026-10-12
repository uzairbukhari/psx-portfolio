import { DashboardRoute } from '../../dashboard-route';
export const metadata = {
  title: 'Mutual fund | Sipwise',
  description: 'Price, holdings and activity for one mutual fund.',
};
export default async function FundPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <DashboardRoute
      returnTo={`/funds/${id}`}
      searchParams={searchParams}
    />
  );
}
