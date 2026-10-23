import { Lock, Play } from 'lucide-react';
import { GoogleButton } from './google-button';
import { NetWorthPreview } from './net-worth-preview';

export function Hero({
  returnTo,
  error,
}: {
  returnTo: string;
  error: string;
}) {
  return (
    <div className="hero">
      <div className="lp-wrap">
        <div className="reveal">
          <span className="lp-eyebrow">
            <i />
            Built for investors in Pakistan
          </span>
          <h1>
            Everything you own,<br /> <span>in one private ledger.</span>
          </h1>
          <p className="lede">
            Track PSX stocks, mutual funds, gold, silver and savings plans side
            by side. See your whole net worth, plan each month&rsquo;s
            investment, and keep it all encrypted so only you can read it.
          </p>
          {error && (
            <p role="alert" className="notice error">
              <strong>Sign-in didn&rsquo;t finish.</strong> {error}
            </p>
          )}
          <GoogleButton returnTo={returnTo} label={error ? 'Try again with Google' : undefined} />
          <div className="cta-note">
            <Lock size={15} aria-hidden="true" />
            End-to-end encrypted. Nothing is shared, and no orders are placed.
          </div>
          <a className="watch-link" href="#how">
            <Play size={14} aria-hidden="true" /> Watch how it works · 2 min
          </a>
        </div>
        <NetWorthPreview />
      </div>
    </div>
  );
}
