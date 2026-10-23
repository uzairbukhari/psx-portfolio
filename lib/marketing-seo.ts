// Titles, descriptions and structured data for the public marketing pages. Pure strings, no I/O.
import { FAQ } from './marketing-faq.ts';

export type MarketingPage = 'home' | 'features' | 'security' | 'pricing' | 'guide';

export const SITE_NAME = 'Sipwise';
export const SITE_ORIGIN = 'https://sipwise.trade';

export const PAGE_META: Record<MarketingPage, { path: string; title: string; description: string }> = {
  home: {
    path: '/',
    title: 'Sipwise: private PSX portfolio tracker and monthly SIP planner',
    description:
      'Track PSX stocks, mutual funds, gold, silver, savings plans and foreign currency in one end-to-end encrypted ledger. Plan each month’s SIP. Free during early access.',
  },
  features: {
    path: '/features',
    title: 'Features | Sipwise',
    description:
      'One net worth across stocks, funds, gold, savings plans and dollars. SIP Blueprint, Future you, Monthly Picks, Insights, broker statement import and Zakat.',
  },
  security: {
    path: '/security',
    title: 'Security and privacy | Sipwise',
    description:
      'Your Sipwise ledger is encrypted on your device with AES-256-GCM. The server stores ciphertext only: no holdings, no amounts, nothing sent to an AI.',
  },
  pricing: {
    path: '/pricing',
    title: 'Pricing | Sipwise',
    description:
      'Sipwise is free during early access. A paid plan comes later; your ledger, your encryption and exporting your data stay free.',
  },
  guide: {
    path: '/guide',
    title: 'Getting started | Sipwise',
    description: 'Set up Sipwise in five steps: sign in, set a vault password, save your recovery key, import a statement and plan your month.',
  },
};

export function pageMetadata(page: MarketingPage) {
  const m = PAGE_META[page];
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: `${SITE_ORIGIN}${m.path}` },
    openGraph: {
      type: 'website' as const,
      url: `${SITE_ORIGIN}${m.path}`,
      siteName: SITE_NAME,
      title: m.title,
      description: m.description,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Sipwise: invest monthly, see everything, share nothing' }],
      locale: 'en_PK',
    },
    twitter: { card: 'summary_large_image' as const },
  };
}

type Json = Record<string, unknown>;

/** JSON-LD for the page. Home carries the organisation, the app and the FAQ; the others carry what they show. */
export function structuredData(page: MarketingPage): Json[] {
  const org: Json = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}/favicon.svg`,
  };
  const app: Json = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'Web, Android',
    description: PAGE_META.home.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'PKR' },
    url: SITE_ORIGIN,
  };
  const faq: Json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.filter((q) => q.schema).map((q) => ({
      '@type': 'Question',
      name: q.q,
      acceptedAnswer: { '@type': 'Answer', text: q.a },
    })),
  };
  const video: Json = {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: 'Get started with Sipwise in 2 minutes',
    description: 'From Google sign-in and your vault password to importing a broker statement and seeing your holdings. Uses a made-up account.',
    thumbnailUrl: `${SITE_ORIGIN}/videos/poster-landscape.jpg`,
    contentUrl: `${SITE_ORIGIN}/videos/sipwise-getting-started-landscape.mp4`,
    uploadDate: '2026-10-23',
    duration: 'PT2M10S',
  };
  if (page === 'home') return [org, app, faq, video];
  if (page === 'pricing') return [org, app, faq];
  return [org];
}

/** Safe to embed inside <script type="application/ld+json">. */
export function jsonLd(data: Json[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export const SITEMAP_PATHS = ['/', '/features', '/security', '/pricing', '/guide', '/download', '/privacy', '/terms'];
