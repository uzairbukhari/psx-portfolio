import { Lock } from 'lucide-react';
import { GoogleButton } from './google-button';
import { NetWorthPreview } from './net-worth-preview';

const CHIPS = [
  ['PSX stocks', 'var(--asset-stocks)'],
  ['Mutual funds', 'var(--asset-funds)'],
  ['Gold', 'var(--asset-gold)'],
  ['Silver', 'var(--asset-silver)'],
  ['Savings plans', 'var(--asset-plans)'],
] as const;

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
            Everything you own, <span>in one private ledger.</span>
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
          <div className="chips">
            {CHIPS.map(([label, color]) => (
              <span className="lp-chip" key={label}>
                <i style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
        <NetWorthPreview />
      </div>
    </div>
  );
}
