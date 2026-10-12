import { getViewer } from '@/lib/auth';
import Dashboard from '../../portfolio';
export const metadata = {
  title: 'Gold and Silver | Sipwise',
  description: 'Holding, value and activity for one gold or silver holding.',
};
export default async function GoldPage() {
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
