/* oxlint-disable next/no-html-link-for-pages -- the marketing pages are separate full pages, plain anchors are intended */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- role=group names a pair of toggle buttons; a fieldset would bring its own box */
import type { ReactNode } from 'react';
import { Noto_Nastaliq_Urdu } from 'next/font/google';
import { LogoMark } from '@/components/logo';
import { hostConfig } from '@/lib/hosts-server';
import type { MarketingPage } from '@/lib/marketing-seo';
import { jsonLd, structuredData } from '@/lib/marketing-seo';
import { CfBeacon } from '../cf-beacon';
import { Defs, GoogleCta } from './parts';
import '../marketing.css';

// Preload is off so the Urdu face is only downloaded once Urdu text is on screen (the language switch).
const urdu = Noto_Nastaliq_Urdu({ subsets: ['arabic'], weight: ['500', '700'], display: 'swap', preload: false, variable: '--font-urdu' });

const LINKS: { href: string; label: string; page: MarketingPage }[] = [
  { href: '/features', label: 'Features', page: 'features' },
  { href: '/security', label: 'Security', page: 'security' },
  { href: '/guide', label: 'Guide', page: 'guide' },
  { href: '/pricing', label: 'Pricing', page: 'pricing' },
];

export function MarketingShell({ page, children }: { page: MarketingPage; children: ReactNode }) {
  const cfg = hostConfig();
  return (
    <div className={`mk ${urdu.variable}`} data-page={page}>
      <CfBeacon />
      <Defs />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structuredData(page)) }} />
      <header className="m-nav">
        <div className="m-wrap">
          <a className="m-brand" href="/" aria-label="Sipwise home">
            <LogoMark size={30} animate />
            <span>Sip<em>wise</em></span>
          </a>
          <nav className="m-nav-links" aria-label="Main">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} aria-current={l.page === page ? 'page' : undefined}>{l.label}</a>
            ))}
          </nav>
          <div className="m-nav-right">
            {page === 'home' && (
              <div className="m-lang" role="group" aria-label="Language">
                <button type="button" data-slot="mk" aria-pressed="true" data-lang="en">EN</button>
                <button type="button" data-slot="mk" aria-pressed="false" data-lang="ur" lang="ur" className="m-ur-plain">اردو</button>
              </div>
            )}
            <GoogleCta cfg={cfg} src="home_nav" small>Start free</GoogleCta>
            <button type="button" data-slot="mk" className="m-menu-btn" id="mk-menu" aria-label="Open menu" aria-expanded="false" aria-controls="mk-sheet">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 5h14M2 9h14M2 13h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      </header>
      <div className="m-sheet" id="mk-sheet" hidden>
        <button type="button" data-slot="mk" className="m-close">Close ✕</button>
        {LINKS.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        <a href="/download">Android app</a>
        <GoogleCta cfg={cfg} src="home_nav" style={{ marginTop: 20, fontSize: 16 }}>Continue with Google</GoogleCta>
      </div>
      <main id="main">{children}</main>
      <footer className="m-footer">
        <div className="m-wrap">
          <div>
            <a className="m-brand" href="/" style={{ fontSize: 18 }}><LogoMark size={26} /><span>Sip<em>wise</em></span></a>
            <p style={{ marginTop: 12, maxWidth: '34ch' }}>A private ledger and monthly investment planner for investors in Pakistan.</p>
          </div>
          <div><h4>Product</h4><a href="/features">Features</a><a href="/security">Security</a><a href="/pricing">Pricing</a><a href="/download">Android app</a></div>
          <div><h4>Learn</h4><a href="/guide">Getting started</a><a href="/#watch">Video tour</a><a href="/#faq">FAQ</a></div>
          <div><h4>Company</h4><a href="/feedback">Contact us</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
          <div className="m-legal">
            <span>© 2026 Sipwise · sipwise.trade</span>
            <span>Sipwise is a tracking and planning tool. It is not investment advice and does not place orders. Figures on this site are illustrations.</span>
          </div>
        </div>
      </footer>
      <script src="/marketing.js" defer />
    </div>
  );
}
