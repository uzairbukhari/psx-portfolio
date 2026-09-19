import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Purchase log | PSX Portfolio',
  description: 'Full ledger of recorded trades and corrections.',
};
export default async function HistoryPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
