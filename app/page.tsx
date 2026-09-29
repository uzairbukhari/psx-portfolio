import { getCurrentUser } from '@/lib/auth';
import Dashboard from './portfolio';
export const metadata = {
  title: 'PSX Portfolio | SIP desk',
  description:
    'Your private portfolio, purchase ledger and monthly SIP planner.',
};
export default async function Home() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
