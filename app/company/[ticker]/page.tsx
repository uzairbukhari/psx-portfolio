import { DashboardRoute } from '../../dashboard-route';
export const metadata = {
  title: 'Company | Sipwise',
  description: 'Price performance, purchases and dividends for one company.',
};
export default async function CompanyPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  return (
    <DashboardRoute
      returnTo={`/company/${ticker}`}
      searchParams={searchParams}
    />
  );
}
