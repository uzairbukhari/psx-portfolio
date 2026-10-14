import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'Research desk | Sipwise',
  description: 'Company research jobs, dossiers and screening.',
};
export default function ResearchDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/research-desk" searchParams={searchParams} adminOnly />;
}
