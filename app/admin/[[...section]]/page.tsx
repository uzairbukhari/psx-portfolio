import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth';
import AdminConsole from '../../admin-console';
import { ADMIN_SECTIONS } from '../../admin-sections';

export const metadata = {
  title: 'Admin console | Sipwise',
  description: 'System health, usage analytics, audit log and internal accounts.',
};

/** Super admins only. Anyone else gets a plain 404, so the console's existence is not revealed. */
export default async function AdminPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/');
  if (viewer.role !== 'super_admin') notFound();
  const parts = (await params).section ?? [];
  if (parts.length === 0) redirect('/admin/overview');
  const section = ADMIN_SECTIONS.find((s) => s.id === parts[0]);
  if (!section || parts.length > 1) notFound();
  return <AdminConsole section={section.id} email={viewer.email} name={viewer.name} picture={viewer.picture} />;
}
