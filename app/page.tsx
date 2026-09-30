import { getViewer } from '@/lib/auth';
import Dashboard from './portfolio';
export const metadata = {
  title: 'FolioRaah — PSX Portfolio & SIP Tracker',
  description:
    'A clear path for every investment.',
};
export default async function Home() {
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
