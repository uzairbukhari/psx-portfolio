import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Future you | Sipwise',
  description: 'See where your monthly SIP could lead, and try what-ifs like stopping early or raising it every year.',
};
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/future" searchParams={searchParams} />;
}
