import { DashboardRoute } from '../../dashboard-route';
export const metadata = {
  title: 'Foreign currency | Sipwise',
  description: 'Holding, value and activity for one foreign currency holding.',
};
export default async function CurrencyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return (
    <DashboardRoute
      returnTo={`/currency/${id}`}
      searchParams={searchParams}
    />
  );
}
