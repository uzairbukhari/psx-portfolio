import { getViewer } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Activity | Sipwise',
  description: 'Every buy, sale, dividend and split, newest first.',
};
export default async function ActivityPage() {
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
