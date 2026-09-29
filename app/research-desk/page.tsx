import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Research desk | PSX Portfolio',
  description: 'Company research jobs, dossiers and screening.',
};
export default async function ResearchDeskPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
