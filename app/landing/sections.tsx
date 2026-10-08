import {
  Check,
  CircleDollarSign,
  Gem,
  Landmark,
  Lock,
  PiggyBank,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { GoogleButton } from './google-button';

const ASSETS = [
  {
    color: 'var(--asset-stocks)',
    Icon: TrendingUp,
    title: 'PSX stocks',
    body: 'Every buy, sale, fee and split, with true average cost. Import AHL and Finqalab statements. Dividends booked automatically.',
    src: 'Prices from PSX during market hours',
  },
  {
    color: 'var(--asset-funds)',
    Icon: Landmark,
    title: 'Mutual funds',
    body: 'Units at the latest repurchase price. Cash payouts count as income; reinvested ones add units.',
    src: 'Daily NAVs from MUFAP',
  },
  {
    color: 'var(--asset-gold)',
    Icon: Gem,
    title: 'Gold & silver',
    body: 'Coins and bars by weight and purity, valued at today’s rupee rate.',
    src: 'Local dealer rate, or spot in rupees',
  },
  {
    color: 'var(--asset-plans)',
    Icon: PiggyBank,
    title: 'Savings plans',
    body: 'Pak-Qatar Mahana Bachat and similar plans: monthly contributions come due for you to confirm.',
    src: 'Estimated between your statements',
  },
];

export function AssetsSection() {
  return (
    <section className="block" id="assets">
      <div className="lp-wrap">
        <div className="kicker">One place for all of it</div>
        <h2>Not just stocks any more.</h2>
        <p className="sub">
          Each kind of investment is valued the way it should be, from public
          prices that refresh on their own. You only record what you bought,
          sold or received.
        </p>
        <div className="assets">
          {ASSETS.map(({ color, Icon, title, body, src }) => (
            <div
              className="asset"
              key={title}
              style={{ '--c': color } as React.CSSProperties}
            >
              <div className="ico">
                <Icon size={18} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
              <div className="src">{src}</div>
            </div>
          ))}
        </div>
        <div className="all-strip">
          <span>
            <b>The All view</b> adds it up: net worth, asset mix, income
            received and your real return across every portfolio.
          </span>
          <span className="lp-chip">Multiple portfolios supported</span>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  [
    'Set your plan',
    'A monthly budget and target weights for the companies and assets you want.',
  ],
  [
    'Get Monthly Picks',
    'Up to 15 companies you chose, scored from PSX filings and prices. No single pick above 35%.',
  ],
  [
    'Record what you bought',
    'Whole shares at the price you paid. Your plan and returns update immediately.',
  ],
];

const PICKS = [
  ['MEBL', 'Meezan Bank', 'Behind target by 4.2%', 'Rs 17,500'],
  ['LUCK', 'Lucky Cement', 'Strong cash flow, fair price', 'Rs 15,000'],
  ['FFC', 'Fauji Fertilizer', 'Dividend yield 9.8%', 'Rs 12,000'],
  ['SYS', 'Systems Ltd', 'Below 52-week average', 'Rs 5,500'],
];

export function PlanSection() {
  return (
    <section className="block" id="plan">
      <div className="lp-wrap split">
        <div>
          <div className="kicker">Monthly SIP planning</div>
          <h2>Decide where next month&rsquo;s money goes.</h2>
          <p className="sub" style={{ marginBottom: 32 }}>
            Set a monthly amount and your targets. Sipwise shows what is behind
            plan and ranks your own shortlist with PSX data.
          </p>
          <ol className="steps">
            {STEPS.map(([title, body], i) => (
              <li key={title}>
                <span className="n">{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="lp-card picks" aria-hidden="true">
          <div className="alloc">
            <span className="lp-label">October picks</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>
              Budget Rs 50,000
            </span>
          </div>
          {PICKS.map(([tick, name, note, amount]) => (
            <div className="pick" key={tick}>
              <span className="tick">{tick}</span>
              <span>
                {name}
                <small>{note}</small>
              </span>
              <span className="mono">{amount}</span>
            </div>
          ))}
          <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--lp-dim)' }}>
            Illustration. Picks are ranked on your device and are not advice.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PrivacySection() {
  return (
    <section className="block privacy" id="privacy">
      <div className="lp-wrap">
        <div className="kicker" style={{ color: 'var(--success)' }}>
          Private by design
        </div>
        <h2>We can&rsquo;t see your portfolio. Nobody can.</h2>
        <p className="sub">
          Your ledger is locked on your device before it is saved. Google
          sign-in only proves it&rsquo;s you; your vault password opens the
          data.
        </p>
        <div className="priv-grid">
          <div className="priv">
            <div className="ic">
              <Lock size={18} aria-hidden="true" />
            </div>
            <h3>End-to-end encrypted</h3>
            <p>
              AES-256 encryption with a key only your vault password or recovery
              key can unlock. The server holds ciphertext.
            </p>
          </div>
          <div className="priv">
            <div className="ic">
              <ShieldCheck size={18} aria-hidden="true" />
            </div>
            <h3>No orders, no broker link</h3>
            <p>
              Sipwise never connects to your broker and never places a trade.
              You stay in control.
            </p>
          </div>
          <div className="priv">
            <div className="ic">
              <CircleDollarSign size={18} aria-hidden="true" />
            </div>
            <h3>Nothing private leaves</h3>
            <p>
              Prices, funds and research use public data only. Holdings and
              amounts are never sent to an AI or a third party.
            </p>
          </div>
        </div>
        <div className="cipher mono" aria-hidden="true">
          <b>What our server stores</b>
          <span>v3.aes-gcm.9f2c&hellip;e4a1 &middot; 7Qx0pZ3mK8vN1bR6tY2wL5cH9dF4gJ0s&hellip;</span>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  'Live PSX prices in market hours',
  'Dividend alerts for what you hold',
  'Reports, tax-year gains and income',
  'Encrypted backups you can restore',
  'Company pages with price history',
  'Broker statement import',
];

export function DevicesSection() {
  return (
    <section className="block" id="devices">
      <div className="lp-wrap devices">
        <div>
          <div className="kicker">Web and phone</div>
          <h2>Same ledger, wherever you check it.</h2>
          <p className="sub" style={{ marginBottom: 28 }}>
            Use Sipwise in any browser or in the Sipwise app on your phone.
            Unlock once per device and your data stays in sync.
          </p>
          <div className="feat-list">
            {FEATURES.map((f) => (
              <div key={f}>
                <Check size={16} aria-hidden="true" />
                {f}
              </div>
            ))}
          </div>
        </div>
        <div className="phone" aria-hidden="true">
          <div className="lp-label">Today</div>
          <div className="nw-value mono">Rs 4,826,350</div>
          <div className="nw-change mono" style={{ fontSize: 12 }}>
            +1.2% today
          </div>
          <div className="mix">
            <i style={{ flex: 46, background: 'var(--asset-stocks)' }} />
            <i style={{ flex: 22, background: 'var(--asset-funds)' }} />
            <i style={{ flex: 15, background: 'var(--asset-gold)' }} />
            <i style={{ flex: 4, background: 'var(--asset-silver)' }} />
            <i style={{ flex: 13, background: 'var(--asset-plans)' }} />
          </div>
          <div className="rows mono">
            {[
              ['MEBL', '+2.4%', 'var(--asset-stocks)', true],
              ['LUCK', '-0.8%', 'var(--asset-stocks)', false],
              ['Meezan Fund', '+0.1%', 'var(--asset-funds)', true],
              ['Gold 24k', '+0.6%', 'var(--asset-gold)', true],
            ].map(([name, chg, color, up]) => (
              <div className="lp-row" key={String(name)}>
                <i style={{ background: String(color) }} />
                <span>{name}</span>
                <span style={{ color: up ? 'var(--gain)' : 'var(--loss)' }}>
                  {chg}
                </span>
              </div>
            ))}
          </div>
          <div className="tabbar">
            <span className="on"><i />Today</span>
            <span><i />Holdings</span>
            <span><i />Plan</span>
            <span><i />Activity</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCta({ returnTo }: { returnTo: string }) {
  return (
    <section className="final">
      <div className="lp-wrap">
        <h2>Start your private ledger.</h2>
        <p className="sub">
          Sign in, set a vault password, and add your first holding or import a
          statement.
        </p>
        <GoogleButton returnTo={returnTo} />
        <div className="cta-note" style={{ justifyContent: 'center' }}>
          Your data stays private to you.
        </div>
      </div>
    </section>
  );
}
