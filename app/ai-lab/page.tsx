import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'AI Lab | Sipwise',
  description: 'Experimental AI stock picks and holdings review.',
};
export default async function AiLabPage() {
  const user = await getViewer();
  if (user && user.role !== 'super_admin') redirect('/');
  return (
    <Dashboard
      email={user?.email ?? null}
      name={user?.name ?? null}
      picture={user?.picture ?? null}
      role={user?.role ?? 'user'}
    />
  );
}
