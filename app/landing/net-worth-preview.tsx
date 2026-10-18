import { Lock } from 'lucide-react';

// Fictional, static numbers for illustration only.
const MIX = [
  ['PSX stocks', 46, 'var(--asset-stocks)'],
  ['Mutual funds', 22, 'var(--asset-funds)'],
  ['Gold', 15, 'var(--asset-gold)'],
  ['Silver', 4, 'var(--asset-silver)'],
  ['Savings plans', 13, 'var(--asset-plans)'],
] as const;

const LINE =
  'M0 78 L24 76 L48 79 L72 74 L96 76 L120 70 L144 72 L168 64 L192 66 L216 56 L240 58 L264 48 L288 50 L312 38 L336 34 L360 24 L388 18';
const MONEY =
  'M0 112 L40 108 L40 104 L90 100 L90 96 L150 92 L150 88 L210 84 L210 80 L270 78 L270 74 L330 72 L388 70';
const RING = 2 * Math.PI * 22;

export function NetWorthPreview() {
  return (
    <div className="visual reveal" aria-hidden="true">
      <div className="nw-slab">
        <div className="nw-top">
          <span className="lp-label">Net worth &middot; All</span>
          <span className="gain-pill">+14.5% this year</span>
        </div>
        <div className="nw-value mono">
          <small>Rs</small>4,826,350
        </div>
        <svg className="spark" viewBox="0 0 450 150">
          <defs>
            <linearGradient id="lp-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--success)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="rgba(148,178,225,.12)" strokeDasharray="2 4">
            <path d="M0 20H388M0 54H388M0 88H388M0 122H388" />
          </g>
          <path d={`${LINE} L388 130 L0 130Z`} fill="url(#lp-spark)" />
          <path d={MONEY} fill="none" stroke="#9fb0d6" strokeOpacity=".7" strokeWidth="1.4" strokeDasharray="4 3" />
          <path d={LINE} fill="none" stroke="var(--success)" strokeWidth="2.2" strokeLinejoin="round" />
          <circle cx="388" cy="18" r="9" fill="var(--success)" fillOpacity=".18" />
          <circle cx="388" cy="18" r="4" fill="var(--success)" />
          <g fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#9fb0d6">
            <text x="450" y="22" textAnchor="end">4.8M</text>
            <text x="450" y="56" textAnchor="end">4.5M</text>
            <text x="450" y="90" textAnchor="end">4.1M</text>
            <text x="450" y="124" textAnchor="end">3.8M</text>
            <text x="0" y="146">Nov</text>
            <text x="96" y="146">Feb</text>
            <text x="192" y="146">May</text>
            <text x="288" y="146">Aug</text>
            <text x="388" y="146" textAnchor="end">Oct</text>
          </g>
        </svg>
        <div className="mix">
          {MIX.map(([name, pct, color]) => (
            <i key={name} style={{ flex: pct, background: color }} />
          ))}
        </div>
      </div>
      <div className="float sip">
        <svg className="sip-ring" viewBox="0 0 54 54">
          <circle cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="6" />
          <circle
            cx="27"
            cy="27"
            r="22"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${RING * 0.72} ${RING}`}
            transform="rotate(-90 27 27)"
          />
        </svg>
        <div>
          <div className="lp-label">October SIP</div>
          <div className="sip-line">
            Rs 36,000 <span>of 50,000</span>
          </div>
        </div>
      </div>
      <div className="float lock">
        <span className="ic">
          <Lock size={20} />
        </span>
        <div>
          <b>Encrypted on this device</b>
          <small>The server stores only ciphertext.</small>
        </div>
      </div>
    </div>
  );
}
