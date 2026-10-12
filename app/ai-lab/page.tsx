import { DashboardRoute } from '../dashboard-route';
export const metadata = {
  title: 'AI Lab | Sipwise',
  description: 'Experimental AI stock picks and holdings review.',
};
export default function AiLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/ai-lab" searchParams={searchParams} adminOnly />;
}
