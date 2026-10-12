import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Settings | Sipwise',
  description: 'Account, tax, AI model and data settings.',
};
export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/settings" searchParams={searchParams} />;
}
