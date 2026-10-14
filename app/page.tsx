import type { Metadata } from 'next';
import { DashboardRoute } from './dashboard-route';

export const metadata: Metadata = {
  title: 'Sipwise: private PSX portfolio tracker and SIP planner',
  description:
    'Track PSX stocks, mutual funds, gold, silver and savings plans in one end-to-end encrypted ledger. Plan your monthly SIP.',
  alternates: { canonical: 'https://sipwise.trade/' },
  openGraph: {
    type: 'website',
    url: 'https://sipwise.trade/',
    siteName: 'Sipwise',
    title: 'Sipwise: your PSX portfolio, privately',
    description:
      'Stocks, funds, gold and savings plans in one encrypted ledger. Only you can read it.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sipwise: everything you own, in one private ledger' }],
    locale: 'en_PK',
  },
  twitter: { card: 'summary_large_image' },
};

export default function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <DashboardRoute returnTo="/" searchParams={searchParams} />;
}
