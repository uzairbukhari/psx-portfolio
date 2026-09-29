import { getCurrentUser } from '@/lib/auth';
import Dashboard from '../../portfolio';
export const metadata = {
  title: 'Company | PSX Portfolio',
  description: 'Price performance, purchases and dividends for one company.',
};
export default async function CompanyPage() {
  const user = await getCurrentUser();
  return <Dashboard email={user?.email ?? null} name={user?.name ?? null} />;
}
