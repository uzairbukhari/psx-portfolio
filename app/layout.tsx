import type { Metadata } from 'next';
import { env } from 'cloudflare:workers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
// Imported once, here: the landing, error and dashboard pages all use it, and importing it from several modules made the
// bundler emit an empty shared script that the page preloaded (a 404 on every load).
import './always-dark.css';
import { StaleBuildReload } from './stale-build-reload';
import { DEFAULT_THEME, THEME_META, themeInitScript } from '@/lib/theme';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://sipwise.trade'),
  title: 'Sipwise',
  description:
    'Track PSX stocks, mutual funds, gold, silver and savings plans in one private, encrypted ledger. Plan your monthly SIP.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      data-app-env={env.APP_ENV === 'staging' ? 'staging' : undefined}
    >
      <head>
        <meta name="theme-color" content={THEME_META[DEFAULT_THEME].bg} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <StaleBuildReload />
        {children}
      </body>
    </html>
  );
}
