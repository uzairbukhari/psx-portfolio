import { getViewer } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Reports | Sipwise',
  description: 'Portfolio performance and allocation reports.',
};
export default async function ReportsPage() {
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
