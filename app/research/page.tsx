import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'AI review | PSX Portfolio',
  description: 'Low-cost AI review of current portfolio targets.',
};
export default async function ResearchPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} />;
}
