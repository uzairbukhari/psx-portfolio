import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Monthly Picks | PSX Portfolio',
  description: 'Sourced 60–90 day research for your PSX shortlist.',
};
export default async function SipPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
