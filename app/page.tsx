import { getViewer } from '@/lib/auth';
import Dashboard from './portfolio';
export const metadata = {
  title: 'Sipwise | SIP desk',
  description:
    'Your private portfolio, purchase ledger and monthly SIP planner.',
};
export default async function Home() {
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
