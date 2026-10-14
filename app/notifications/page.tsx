import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Notifications | Sipwise',
  description: 'Every notification, including the ones you cleared.',
};
export default function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/notifications" searchParams={searchParams} />;
}
