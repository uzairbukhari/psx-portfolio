import { getViewer } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Notifications | Sipwise',
  description: 'Every notification, including the ones you cleared.',
};
export default async function NotificationsPage() {
  const user = await getViewer();
  return (
    <Dashboard
      email={user?.email ?? null}
      name={user?.name ?? null}
      picture={user?.picture ?? null}
      role={user?.role ?? 'user'}
    />
  );
}
