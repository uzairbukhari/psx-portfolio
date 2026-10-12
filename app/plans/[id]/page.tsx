import { DashboardRoute } from '../../dashboard-route';
export const metadata = {
  title: 'Savings plan | Sipwise',
  description: 'Value and activity for one savings plan.',
};
export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <DashboardRoute
      returnTo={`/plans/${id}`}
      searchParams={searchParams}
    />
  );
}
