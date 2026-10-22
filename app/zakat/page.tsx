import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Zakat | Sipwise',
  description: 'Track the zakat you owe over your zakat year, and the zakat you have paid, from your own portfolio.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/zakat" searchParams={searchParams} />;
}
