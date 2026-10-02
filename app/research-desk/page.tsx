import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Research desk | Sipwise',
  description: 'Company research jobs, dossiers and screening.',
};
export default async function ResearchDeskPage() {
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
