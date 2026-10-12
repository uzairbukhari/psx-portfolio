import { DashboardRoute } from '../../dashboard-route';
export const metadata = {
  title: 'Gold and Silver | Sipwise',
  description: 'Holding, value and activity for one gold or silver holding.',
};
export default async function GoldPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <DashboardRoute
      returnTo={`/gold/${id}`}
      searchParams={searchParams}
    />
  );
}
