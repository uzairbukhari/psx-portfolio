import type { Metadata } from 'next';
import { env } from 'cloudflare:workers';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import './ledger.css';
import './picks.css';
import './ai-lab.css';
import './reports.css';
import './account-overview.css';
import './settings.css';
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
        {children}
      </body>
    </html>
  );
}
