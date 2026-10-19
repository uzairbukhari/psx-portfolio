import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'SIP Blueprint | Sipwise',
  description: 'Split your monthly budget across stocks, funds, gold and currency, then tick off each step.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/sip-tracker" searchParams={searchParams} />;
}
