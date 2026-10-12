import { getViewer } from '@/lib/auth';
import Dashboard from '../../portfolio';
export const metadata = {
  title: 'Savings plan | Sipwise',
  description: 'Value and activity for one savings plan.',
};
export default async function PlanPage() {
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
