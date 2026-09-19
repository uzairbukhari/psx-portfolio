import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../portfolio';
export const metadata = {
  title: 'Monthly SIP | PSX Portfolio',
  description: 'Monthly SIP budget and whole-share allocation plan.',
};
export default async function SipPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
