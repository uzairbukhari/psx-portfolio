import { Lock } from 'lucide-react';

// Fictional, static numbers for illustration only.
const MIX = [
  ['PSX stocks', 'Rs 2,220,120', 46, 'var(--asset-stocks)'],
  ['Mutual funds', 'Rs 1,061,800', 22, 'var(--asset-funds)'],
  ['Gold', 'Rs 723,950', 15, 'var(--asset-gold)'],
  ['Silver', 'Rs 193,050', 4, 'var(--asset-silver)'],
  ['Savings plans', 'Rs 627,430', 13, 'var(--asset-plans)'],
] as const;

const LINE =
  'M0 58 L30 55 L60 57 L90 50 L120 52 L150 44 L180 46 L210 38 L240 40 L270 30 L300 33 L330 22 L360 18 L400 10';

export function NetWorthPreview() {
  return (
    <div className="visual reveal" aria-hidden="true">
      <div className="lp-card nw">
        <div className="nw-top">
          <span className="lp-label">Net worth &middot; All</span>
          <div className="lp-seg">
            <b>1M</b>
            <b className="on">1Y</b>
            <b>All</b>
          </div>
        </div>
        <div className="nw-value mono">Rs 4,826,350</div>
        <div className="nw-change">
          <span className="mono" style={{ color: 'inherit', fontWeight: 600 }}>
            +Rs 612,480 &nbsp;+14.5%
          </span>{' '}
          <span>this year</span>
        </div>
        <svg className="spark" viewBox="0 0 400 70" preserveAspectRatio="none">
          <defs>
            <linearGradient id="lp-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--primary)" stopOpacity=".35" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${LINE} L400 70 L0 70Z`} fill="url(#lp-spark)" />
          <path d={LINE} fill="none" stroke="var(--primary-2)" strokeWidth="2" />
          <circle cx="400" cy="10" r="3.5" fill="var(--success)" />
        </svg>
        <div className="mix">
          {MIX.map(([name, , pct, color]) => (
            <i key={name} style={{ flex: pct, background: color }} />
          ))}
        </div>
        <div className="rows">
          {MIX.map(([name, value, pct, color]) => (
            <div className="lp-row" key={name}>
              <i style={{ background: color }} />
              <span>{name}</span>
              <span className="v">{value}</span>
              <span className="p">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="lp-card float sip">
        <b>October SIP</b>
        <small>Rs 36,000 of Rs 50,000 invested</small>
        <div className="lp-bar">
          <i />
        </div>
        <small className="mono">3 picks &middot; 2 to go</small>
      </div>
      <div className="lp-card float lock">
        <span className="ic">
          <Lock size={16} />
        </span>
        <div>
          <b>Encrypted on this device</b>
          <small>
            Sipwise stores only ciphertext. Your vault password never leaves
            you.
          </small>
        </div>
      </div>
    </div>
  );
}
