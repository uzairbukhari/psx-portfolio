import Link from 'next/link';
import { LogoMark, Wordmark } from '@/components/logo';
import '../landing.css';

export function LandingNav({ returnTo }: { returnTo?: string }) {
  const signIn = `/api/auth/google/login?return_to=${encodeURIComponent(returnTo ?? '/')}`;
  return (
    <nav className="lp-nav" aria-label="Sipwise">
      <div className="lp-wrap">
        <Link className="lp-brand" href="/">
          <LogoMark size={28} />
          <Wordmark />
        </Link>
        <div className="nav-links">
          <Link href="/#assets">What it tracks</Link>
          <Link href="/#plan">Monthly plan</Link>
          <Link href="/#privacy">Privacy</Link>
          <Link href="/#devices">Web &amp; phone</Link>
        </div>
        <a className="nav-cta" href={signIn} target="_top">
          Sign in
        </a>
      </div>
    </nav>
  );
}

export function LandingFooter() {
  return (
    <div className="lp-footer">
      <div className="lp-wrap">
        <span>&copy; 2026 Sipwise &middot; sipwise.trade</span>
        <span className="lp-footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </span>
        <span>
          Sipwise is a tracking and planning tool. It is not investment advice
          and does not place orders.
        </span>
      </div>
    </div>
  );
}
