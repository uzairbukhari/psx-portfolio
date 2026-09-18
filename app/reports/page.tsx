import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Reports | PSX Portfolio',
  description: 'Portfolio performance and allocation reports.',
};
export default async function ReportsPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} />;
}
