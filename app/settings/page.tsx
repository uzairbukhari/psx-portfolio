import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Settings | PSX Portfolio',
  description: 'Account, tax, AI model and data settings.',
};
export default async function SettingsPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
