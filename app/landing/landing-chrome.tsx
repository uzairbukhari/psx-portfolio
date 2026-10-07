/* oxlint-disable next/no-html-link-for-pages -- full page loads are intended, see LandingNav */
import { LogoMark, Wordmark } from '@/components/logo';
import '../landing.css';

// Plain anchors on purpose: the landing page is mounted inside the app shell,
// so a full page load is the reliable way to reach /privacy and /terms.
export function LandingNav({
  returnTo,
  onLanding = false,
}: {
  returnTo?: string;
  onLanding?: boolean;
}) {
  const home = onLanding ? '' : '/';
  const signIn = `/api/auth/google/login?return_to=${encodeURIComponent(returnTo ?? '/')}`;
  return (
    <nav className="lp-nav" aria-label="Sipwise">
      <div className="lp-wrap">
        <a className="lp-brand" href="/">
          <LogoMark size={28} />
          <Wordmark />
        </a>
        <div className="nav-links">
          <a href={`${home}#assets`}>What it tracks</a>
          <a href={`${home}#plan`}>Monthly plan</a>
          <a href={`${home}#privacy`}>Privacy</a>
          <a href={`${home}#devices`}>Web &amp; phone</a>
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
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </span>
        <span>
          Sipwise is a tracking and planning tool. It is not investment advice
          and does not place orders.
        </span>
      </div>
    </div>
  );
}
