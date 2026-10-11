import { getViewer } from '@/lib/auth';
import Dashboard from '../../portfolio';
export const metadata = {
  title: 'Mutual fund | Sipwise',
  description: 'Price, holdings and activity for one mutual fund.',
};
export default async function FundPage() {
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
