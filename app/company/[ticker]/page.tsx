import { getViewer } from '@/lib/auth';
import Dashboard from '../../portfolio';
export const metadata = {
  title: 'Company | Sipwise',
  description: 'Price performance, purchases and dividends for one company.',
};
export default async function CompanyPage() {
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
