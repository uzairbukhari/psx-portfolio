/* oxlint-disable next/no-html-link-for-pages -- plain anchors between marketing pages, see shell.tsx */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- role=group names a pair of toggle buttons; a fieldset would bring its own box */
import { LogoMark } from '@/components/logo';
import { appOrigin } from '@/lib/hosts';
import { hostConfig } from '@/lib/hosts-server';
import { FAQ } from '@/lib/marketing-faq';
import { CALC_DEFAULTS, calcView, lineChart, planChart, sampleSeries } from '@/lib/marketing-math';
import { GoogleCta, Icon, Svg } from './parts';
import { MarketingShell } from './shell';

const EN_H1 = '<span class="m-l">Invest monthly.</span><span class="m-l m-grad">See everything.</span><span class="m-l m-l3">Share nothing.</span>';
const EN_LINES = 'Invest monthly.|See everything.|Share nothing.';
const UR_LINES = 'ہر مہینے سرمایہ کاری۔|سب کچھ ایک نظر میں۔|کسی سے کچھ شیئر نہیں۔';
const EN_LEDE = 'Sipwise keeps your PSX shares, mutual funds, gold, savings plans and dollars in one encrypted ledger. It plans next month’s investment and shows where the habit takes you.';
const UR_LEDE = 'سپ وائز آپ کے پی ایس ایکس شیئرز، میوچل فنڈز، سونا، بچت اسکیمیں اور ڈالر ایک خفیہ لیجر میں رکھتا ہے۔';

const NW = sampleSeries(60, 3.62e6, 4.826e6, 9e4, 7);
const INVESTED = Array.from({ length: 60 }, (_, i) => 3.55e6 + Math.floor(i / 5) * 6.2e4);

const TAPE: [string, string][] = [
  ['PSX stocks', '--stocks'], ['MUFAP funds', '--funds'], ['Gold 24k', '--gold'], ['Silver', '--silver'], ['Mahana Bachat', '--plans'],
  ['USD · AED · SAR', '--fx'], ['Dividends', '--mint'], ['Zakat', '--amber'], ['KSE-100', '--blue'],
];

function Hero() {
  const cfg = hostConfig();
  return (
    <div className="m-hero">
      <div className="m-aurora" aria-hidden="true" />
      <div className="m-floor" aria-hidden="true" />
      <div className="m-wrap m-hero-grid">
        <div>
          <span className="m-pill"><b>Free</b> Early access · made for PSX investors</span>
          <h1 data-lines data-en={EN_LINES} data-ur={UR_LINES} dangerouslySetInnerHTML={{ __html: EN_H1 }} />
          <p className="m-lede" data-en={EN_LEDE} data-ur={UR_LEDE}>{EN_LEDE}</p>
          <div className="m-cta-row">
            <GoogleCta cfg={cfg} src="home_hero">Continue with Google</GoogleCta>
            <a className="m-btn m-btn-ghost" href="#watch"><Icon name="play" /> Watch the 2-minute tour</a>
          </div>
          <div className="m-trust">
            <span><Icon name="lock" size={15} />End-to-end encrypted</span>
            <span><Icon name="check" size={14} />No broker link, no orders</span>
            <span><Icon name="check" size={14} />English and اردو</span>
          </div>
        </div>
        <div className="m-stage" id="mk-stage" aria-hidden="true">
          <div className="m-float m-f1">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <svg className="m-ring" viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(110,162,255,.18)" strokeWidth="4" /><circle cx="20" cy="20" r="16" fill="none" stroke="#6EA2FF" strokeWidth="4" strokeLinecap="round" strokeDasharray="100.5" strokeDashoffset="28" transform="rotate(-90 20 20)" /></svg>
              <div><small>October SIP</small><b className="m-num">Rs 36,000 <span className="m-muted">of 50,000</span></b></div>
            </div>
          </div>
          <div className="m-slab" id="mk-slab">
            <div className="m-slab-top"><span>Net worth · all portfolios</span><span className="m-chip">+14.5% this year</span></div>
            <div className="m-big m-num"><small>Rs</small><span id="mk-nw" data-end="4826350" suppressHydrationWarning>4,826,350</span></div>
            <Svg className="m-chart" viewBox="0 0 440 170" draw inner={lineChart(NW, { width: 440, height: 170, steps: INVESTED })} />
            <div className="m-mixbar"><i style={{ flex: 46, background: 'var(--stocks)' }} /><i style={{ flex: 20, background: 'var(--funds)' }} /><i style={{ flex: 14, background: 'var(--gold)' }} /><i style={{ flex: 4, background: 'var(--silver)' }} /><i style={{ flex: 9, background: 'var(--plans)' }} /><i style={{ flex: 7, background: 'var(--fx)' }} /></div>
            <div className="m-legend"><span><i style={{ background: 'var(--stocks)' }} />Stocks</span><span><i style={{ background: 'var(--funds)' }} />Funds</span><span><i style={{ background: 'var(--gold)' }} />Gold</span><span><i style={{ background: 'var(--plans)' }} />Plans</span><span><i style={{ background: 'var(--fx)' }} />USD</span></div>
          </div>
          <div className="m-float m-f3"><small>Dividend booked</small><b className="m-num">MEBL · Rs 4,200</b><small className="m-up">Paid on its own</small></div>
          <div className="m-float m-f2"><span className="m-ic"><Icon name="shield" /></span><div><b>Locked on this device</b><small>Our server stores only ciphertext</small></div></div>
        </div>
      </div>
      <div className="m-tape" aria-hidden="true">
        <div className="m-tape-in">
          {[0, 1].flatMap((k) => TAPE.map(([t, c]) => <span key={`${k}-${t}`}><i style={{ background: `var(${c})` }} />{t}</span>))}
        </div>
      </div>
    </div>
  );
}

function Story() {
  return (
    <section className="m-sec" id="how">
      <div className="m-wrap">
        <div className="m-sec-head m-reveal"><span className="m-kicker">How it works</span><h2>One month, one step. <span className="m-grad">Watch the staircase climb.</span></h2></div>
        <div className="m-story">
          <div className="m-story-vis" aria-hidden="true">
            <div className="m-scene m-on" data-scene="0">
              <div className="m-card"><div className="m-row"><b>SIP Blueprint</b><span className="m-badge">Rs 50,000 / month</span></div>
                <div className="m-row"><span>Stocks · 60%</span><span className="m-num">Rs 30,000</span></div>
                <div className="m-row"><span>Equity funds · 25%</span><span className="m-num">Rs 12,500</span></div>
                <div className="m-row"><span>Gold · 15%</span><span className="m-num">Rs 7,500</span></div></div>
              <div className="m-card"><div className="m-row"><span className="m-muted">Yearly raise</span><b className="m-num">+10%</b></div><div className="m-bar" style={{ marginTop: 12 }}><i style={{ width: '72%' }} /></div><div className="m-row" style={{ border: 0, marginTop: 8, paddingTop: 0 }}><span className="m-muted" style={{ fontSize: 12 }}>October: Rs 36,000 invested</span><span className="m-num" style={{ fontSize: 12 }}>72%</span></div></div>
            </div>
            <div className="m-scene" data-scene="1">
              <div className="m-card"><div className="m-row"><b>AHL statement · Oct 2026</b><span className="m-badge m-mint">Checked</span></div>
                <div className="m-row"><span><span className="m-tick" style={{ background: '#1E3A8A' }}>MEBL</span> Buy 120</span><span className="m-num">Rs 31,920</span></div>
                <div className="m-row"><span><span className="m-tick" style={{ background: '#7C2D12' }}>LUCK</span> Buy 30</span><span className="m-num">Rs 28,410</span></div>
                <div className="m-row"><span><span className="m-tick" style={{ background: '#065F46' }}>FFC</span> Buy 60</span><span className="m-num">Rs 23,880</span></div>
                <div className="m-row"><span className="m-muted">Fees found</span><span className="m-num m-muted">Rs 214</span></div></div>
              <div className="m-card" style={{ fontSize: 14 }}><b>Nothing is saved until you review it.</b> <span className="m-muted">You see every line before it joins your ledger.</span></div>
            </div>
            <div className="m-scene" data-scene="2">
              <div className="m-card"><div className="m-row"><b>Dividends</b><span className="m-badge m-mint">Automatic</span></div>
                <div className="m-row"><span>MEBL · interim 70%</span><span className="m-num m-up">+ Rs 4,200</span></div>
                <div className="m-row"><span>FFC · final 50%</span><span className="m-num m-up">+ Rs 1,500</span></div>
                <div className="m-row"><span>HBL · expected 28 Oct</span><span className="m-badge m-amber">Expected</span></div></div>
              <div className="m-card"><div className="m-row"><span className="m-muted">Income this tax year</span><b className="m-num">Rs 38,640</b></div></div>
            </div>
            <div className="m-scene" data-scene="3">
              <div className="m-card" style={{ padding: 18 }}><div className="m-row" style={{ marginBottom: 6 }}><b>Future you</b><span className="m-badge">Plan vs what-if</span></div>
                <Svg viewBox="0 0 400 180" style={{ width: '100%', height: 'auto' }} inner={planChart()} />
                <div className="m-row"><span className="m-muted">At 20 years</span><b className="m-num m-up">Rs 5.6 crore</b></div></div>
              <p className="m-fine" style={{ textAlign: 'center' }}>Illustration with an assumed return. Not a forecast.</p>
            </div>
          </div>
          <div className="m-story-steps">
            <div className="m-sstep m-on" data-step="0"><span className="m-n">STEP 1 · PLAN</span><h3>Set your monthly amount and your mix.</h3><p>The SIP Blueprint splits each month’s budget across stocks, funds and gold, tracks what you have already put in, and nudges you when a month is behind.</p></div>
            <div className="m-sstep" data-step="1"><span className="m-n">STEP 2 · RECORD</span><h3>Import a statement, or add a buy in seconds.</h3><p>Drop in your broker’s PDF. Sipwise reads it on your device, finds trades, fees and holdings, and shows you everything before saving.</p></div>
            <div className="m-sstep" data-step="2"><span className="m-n">STEP 3 · RELAX</span><h3>Prices, NAVs and dividends update themselves.</h3><p>PSX prices in market hours, MUFAP fund prices daily, gold, silver and dollar rates, and dividends booked when companies pay.</p></div>
            <div className="m-sstep" data-step="3"><span className="m-n">STEP 4 · LOOK AHEAD</span><h3>See where the habit takes you.</h3><p>Future you projects your plan month by month. Try a what-if: a raise, a pause, a market fall. Nothing is saved unless you keep it.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

const SPARK = sampleSeries(80, 180, 241, 14, 11).map((v) => v * 1e4);

function Bento() {
  const tile = (c: string) => ({ '--c': `var(${c})` }) as React.CSSProperties;
  return (
    <section className="m-sec" id="tracks">
      <div className="m-wrap">
        <div className="m-sec-head m-reveal"><span className="m-kicker">One place for all of it</span><h2>Everything you own, valued the way it should be.</h2><p className="m-lede">You record what you bought, sold or received. Public prices do the rest.</p></div>
        <div className="m-bento">
          <div className="m-tile m-xl" style={tile('--stocks')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></div>
            <h3>PSX stocks</h3><p>True average cost through every buy, sale, bonus and split. Company pages with price history, key statistics and your own buys marked on the chart.</p>
            <Svg className="m-viz" viewBox="0 0 520 90" style={{ width: '100%', height: 'auto' }} inner={lineChart(SPARK, { width: 520, height: 90, labels: false, padR: 0, padB: 4, color: '#6EA2FF', area: 'mk-area-b' })} />
            <span className="m-src">Prices from PSX during market hours</span>
          </div>
          <div className="m-tile" style={tile('--funds')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg></div>
            <h3>Mutual funds</h3><p>Units at the latest repurchase price. Reinvested payouts add units.</p>
            <div className="m-card" style={{ padding: '10px 14px', fontSize: 13, background: 'rgba(7,11,24,.6)' }}><div className="m-row"><span>Equity fund</span><span className="m-num m-up">+0.4%</span></div><div className="m-row"><span>Money market</span><span className="m-num m-up">+0.05%</span></div></div>
            <span className="m-src">Daily prices from MUFAP</span>
          </div>
          <div className="m-tile" style={tile('--gold')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12l4 6-10 12L2 9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></div>
            <h3>Gold &amp; silver</h3><p>Coins and bars by weight and karat, at today’s rupee rate per tola.</p><span className="m-src">Local rate, or spot in rupees</span>
          </div>
          <div className="m-tile" style={tile('--plans')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></div>
            <h3>Savings plans</h3><p>Mahana Bachat style plans: monthly contributions come due for you to confirm.</p><span className="m-src">From your statement values</span>
          </div>
          <div className="m-tile" style={tile('--fx')}>
            <div className="m-ico"><span className="m-num" style={{ fontWeight: 700 }}>$</span></div>
            <h3>Dollars, dirhams, riyals</h3><p>Cash you keep in USD, AED or SAR, with what you paid in rupees.</p><span className="m-src">Open-market rates</span>
          </div>
          <div className="m-tile m-wide" style={tile('--mint')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg></div>
            <h3>Zakat <span className="m-beta">Beta</span></h3><p>Your zakat day on the Hijri calendar, nisab from today’s silver or gold rate, shares at full value or 25%, and payments made in advance.</p><span className="m-src">Worked out on your device</span>
          </div>
          <div className="m-tile m-wide" style={tile('--violet')}>
            <div className="m-ico"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /></svg></div>
            <h3>Insights that explain themselves</h3><p>Net worth, return bridge, income calendar, concentration, you against the KSE-100 and inflation, each with a plain-language takeaway.</p><span className="m-src">Guided or Advanced, your choice</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Calculator() {
  const cfg = hostConfig();
  const v = calcView(CALC_DEFAULTS);
  return (
    <section className="m-sec" id="future">
      <div className="m-wrap">
        <div className="m-sec-head m-reveal"><span className="m-kicker">Try it now, no sign-in</span><h2>How far can <span className="m-grad">Rs <span id="hdAmt">25,000</span> a month</span> go?</h2><p className="m-lede">Move the sliders. This runs only in your browser. It uses the same month-by-month maths as Future you in the app.</p></div>
        <div className="m-calc">
          <div className="m-ctrls">
            <div className="m-ctrl"><label htmlFor="cAmt">Monthly amount <output id="oAmt" className="m-num">Rs 25,000</output></label><input type="range" id="cAmt" min="5000" max="300000" step="5000" defaultValue="25000" /></div>
            <div className="m-ctrl"><label htmlFor="cYrs">Years <output id="oYrs" className="m-num">15</output></label><input type="range" id="cYrs" min="1" max="30" step="1" defaultValue="15" /></div>
            <div className="m-ctrl"><label htmlFor="cRet">Assumed yearly return <output id="oRet" className="m-num">12%</output></label><input type="range" id="cRet" min="4" max="24" step="1" defaultValue="12" /></div>
            <div className="m-ctrl"><label htmlFor="cStep">Raise each year <output id="oStep" className="m-num">10%</output></label><input type="range" id="cStep" min="0" max="25" step="1" defaultValue="10" /></div>
            <GoogleCta cfg={cfg} src="home_calculator" style={{ marginTop: 6 }}>Make this my plan</GoogleCta>
          </div>
          <div className="m-calc-out">
            <div className="m-kpis">
              <div className="m-kpi"><small>You put in</small><b className="m-num" id="kIn">{v.invested}</b></div>
              <div className="m-kpi"><small>It could grow to</small><b className="m-num m-g" id="kOut">{v.value}</b></div>
              <div className="m-kpi"><small>Monthly in final year</small><b className="m-num" id="kLast">{v.last}</b></div>
            </div>
            <svg id="calcChart" viewBox="0 0 640 280" role="img" aria-label="Projected value by year, with the money you put in" dangerouslySetInnerHTML={{ __html: v.svg }} />
            <p className="m-fine">Illustration only. Assumes the same return every year, which markets never give. Past PSX returns do not promise future ones. Not investment advice.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PrivacyDemo() {
  return (
    <section className="m-sec" id="privacy">
      <div className="m-wrap">
        <div className="m-sec-head m-reveal"><span className="m-kicker">Private by design</span><h2>Your portfolio is locked <span className="m-grad">before it leaves your device.</span></h2><p className="m-lede">Type something below. It is encrypted right here in your browser with AES-256-GCM, the way Sipwise locks your ledger.</p></div>
        <div className="m-vault">
          <div className="m-term">
            <div className="m-term-h"><i /><i /><i /><span style={{ marginLeft: 8 }}>your-device</span></div>
            <div className="m-term-b">
              <label htmlFor="mk-plain">You type</label>
              <input id="mk-plain" defaultValue="MEBL 500 shares, avg Rs 241.30" autoComplete="off" spellCheck={false} />
              <div className="m-arrow">AES-256-GCM, key from your vault password</div>
              <span className="m-label">Our server stores</span>
              <div className="m-cipher" id="mk-cipher" aria-live="polite" suppressHydrationWarning>v3.aes-gcm.9f2cQx0pZ3mK8vN1bR6tY2wL5cH9dF4gJ0sA7kTn.Zm1yU8cE4hX2vB6nQ3pL9dR5wS0jK7gF1aY4tM=</div>
            </div>
          </div>
          <div className="m-pillars">
            <div className="m-pillar"><span className="m-ic"><Icon name="lock" size={18} /></span><div><h3>Only your password opens it</h3><p>Google sign-in proves it is you. Your vault password, or the recovery key you keep, is what opens the data.</p></div></div>
            <div className="m-pillar"><span className="m-ic"><Icon name="eye" size={18} /></span><div><h3>We cannot see your holdings</h3><p>No amounts, budgets or notes reach the server, an AI or anyone else. Prices come from public data.</p></div></div>
            <div className="m-pillar"><span className="m-ic"><Icon name="link" size={18} /></span><div><h3>No broker link, no trades</h3><p>Sipwise never connects to your broker account and never places an order. You stay in control.</p></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Tour() {
  return (
    <section className="m-sec" id="watch">
      <div className="m-wrap">
        <div className="m-sec-head m-center m-reveal"><span className="m-kicker">See it in 2 minutes</span><h2>From sign-in to your holdings.</h2><p className="m-lede">A walkthrough with a made-up account and statement. Urdu narration or English with captions.</p></div>
        <div className="m-player">
          <div className="m-player-bar">
            <div className="m-seg" role="group" aria-label="Video language"><button type="button" data-slot="mk" aria-pressed="true" data-vlang="ur" lang="ur" className="m-ur-plain">اردو</button><button type="button" data-slot="mk" aria-pressed="false" data-vlang="en">English</button></div>
            <div className="m-seg" role="group" aria-label="Video shape"><button type="button" data-slot="mk" aria-pressed="true" data-vshape="landscape">Wide</button><button type="button" data-slot="mk" aria-pressed="false" data-vshape="portrait">Phone</button></div>
          </div>
          {/* The Urdu cut is narration only, by design (no captions); the English cut gets captions from the script. */}
          {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
          <video id="mk-vid" controls playsInline preload="none" poster="/videos/poster-urdu-landscape.jpg" aria-label="Sipwise getting started video">
            <source src="/videos/sipwise-getting-started-urdu-landscape.mp4" type="video/mp4" />
          </video>
          <div className="m-chapters" id="mk-chapters">
            <button type="button" data-slot="mk" data-t="5">0:05 Sign in</button><button type="button" data-slot="mk" data-t="18">0:18 Vault password</button><button type="button" data-slot="mk" data-t="42">0:42 Recovery key</button><button type="button" data-slot="mk" data-t="62">1:02 Statement</button><button type="button" data-slot="mk" data-t="84">1:24 Review</button><button type="button" data-slot="mk" data-t="108">1:48 Holdings</button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Devices() {
  const lap = sampleSeries(40, 3.8e6, 4.826e6, 7e4, 3);
  return (
    <section className="m-sec" id="devices">
      <div className="m-wrap m-devices">
        <div>
          <span className="m-kicker">Web and Android</span>
          <h2 style={{ fontSize: 'clamp(32px,4.4vw,52px)', fontWeight: 700, letterSpacing: '-.04em', margin: '18px 0 16px' }}>Same ledger on your laptop and your phone.</h2>
          <p className="m-lede">Unlock once per device. Everything stays in sync and stays encrypted.</p>
          <div className="m-checks">
            {['Live PSX prices in market hours', 'Dividend alerts for what you hold', 'Tax-year gains and income', 'Encrypted backups you can restore', 'Up to four portfolios', 'Fingerprint unlock on Android'].map((t) => (
              <span key={t}><Icon name="check" size={14} />{t}</span>
            ))}
          </div>
          <div className="m-stores">
            <a className="m-store" href="/download" aria-label="Download the Android app"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 5l-1.5-2M16 5l1.5-2M6 9a6 6 0 0 1 12 0" fill="none" stroke="#2EE6A6" strokeWidth="1.8" strokeLinecap="round" /></svg><span><small>Download for</small><b>Android</b></span></a>
            <a className="m-store" href={`${appOrigin(hostConfig())}/`} aria-label="Open Sipwise in your browser"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="#6EA2FF" strokeWidth="1.8" /><path d="M8 21h8" stroke="#6EA2FF" strokeWidth="1.8" strokeLinecap="round" /></svg><span><small>Open in any</small><b>Browser</b></span></a>
          </div>
        </div>
        <div className="m-duo" aria-hidden="true">
          <div className="m-laptop">
            <div className="m-side"><b>Sipwise</b><span className="m-on">Holdings</span><span>Insights</span><span>SIP Blueprint</span><span>Future you</span><span>Activity</span><span>Zakat</span></div>
            <div style={{ display: 'grid', gap: 10, alignContent: 'start', minWidth: 0 }}>
              <div className="m-card" style={{ padding: '12px 14px', background: 'linear-gradient(160deg,#1C2E5C,#0A1228)' }}><div className="m-muted" style={{ fontSize: 10, letterSpacing: '.1em' }}>NET WORTH</div><div className="m-num" style={{ fontSize: 24, fontWeight: 600 }}>Rs 4,826,350</div><Svg viewBox="0 0 300 60" style={{ width: '100%', height: 'auto' }} inner={lineChart(lap, { width: 300, height: 60, labels: false, grid: false, padR: 0, padB: 4 })} /></div>
              <div className="m-card" style={{ padding: '10px 14px', fontSize: 12 }}><div className="m-row"><span>MEBL</span><span className="m-num m-up">+2.4%</span></div><div className="m-row"><span>LUCK</span><span className="m-num m-down">−0.8%</span></div><div className="m-row"><span>Meezan Islamic Fund</span><span className="m-num m-up">+0.1%</span></div></div>
            </div>
          </div>
          <div className="m-phone">
            <div className="m-muted" style={{ fontSize: 10, letterSpacing: '.1em' }}>TODAY</div>
            <div className="m-num" style={{ fontSize: 22, fontWeight: 600 }}>Rs 4,826,350</div>
            <div className="m-num m-up" style={{ fontSize: 11 }}>+1.2% today</div>
            <div className="m-mixbar"><i style={{ flex: 46, background: 'var(--stocks)' }} /><i style={{ flex: 20, background: 'var(--funds)' }} /><i style={{ flex: 14, background: 'var(--gold)' }} /><i style={{ flex: 9, background: 'var(--plans)' }} /><i style={{ flex: 7, background: 'var(--fx)' }} /></div>
            <div className="m-card" style={{ padding: 10, fontSize: 11 }}><div className="m-row"><span>MEBL</span><span className="m-num m-up">+2.4%</span></div><div className="m-row"><span>Gold 24k</span><span className="m-num m-up">+0.6%</span></div><div className="m-row"><span>USD</span><span className="m-num">Rs 281.4</span></div></div>
            <div className="m-card" style={{ padding: 10, fontSize: 11 }}><b>October SIP</b><div className="m-bar" style={{ marginTop: 8 }}><i style={{ width: '72%' }} /></div></div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Plans() {
  const cfg = hostConfig();
  return (
    <>
      <div className="m-plans">
        <div className="m-plan m-now">
          <span className="m-badge m-mint" style={{ justifySelf: 'start' }}>Early access · now</span>
          <div className="m-price m-num">Rs 0 <small>/ month</small></div>
          <ul>
            {['Every asset class and up to four portfolios', 'SIP Blueprint, Monthly Picks and Future you', 'Statement import and automatic dividends', 'Web and Android'].map((t) => <li key={t}><Icon name="check" size={14} />{t}</li>)}
          </ul>
          <GoogleCta cfg={cfg} src="home_pricing">Start free</GoogleCta>
        </div>
        <div className="m-plan m-later">
          <span className="m-badge" style={{ justifySelf: 'start' }}>Sipwise Plus · later</span>
          <div className="m-price m-num" style={{ color: 'var(--muted)' }}>Coming <small>with more to do</small></div>
          <ul>
            {['Deeper research and company dossiers', 'More portfolios and family sharing', 'Priority support'].map((t) => <li key={t}><Icon name="check" size={14} />{t}</li>)}
          </ul>
          <span className="m-fine">Ideas, not promises. Tell us what you would pay for on the <a href="/feedback" style={{ textDecoration: 'underline' }}>contact page</a>.</span>
        </div>
      </div>
      <div className="m-promise"><span style={{ color: 'var(--mint)', flex: 'none' }}><Icon name="shield" size={18} /></span><span><b style={{ color: 'var(--text)' }}>Always free:</b> your ledger, your encryption, and exporting everything you entered.</span></div>
    </>
  );
}

export function FaqList() {
  return (
    <div className="m-faq">
      {FAQ.map((f, i) => (
        <details key={f.q} open={i === 0}>
          <summary className={f.urdu ? 'm-ur-plain' : undefined} lang={f.urdu ? 'ur' : undefined} dir={f.urdu ? 'rtl' : undefined}>{f.q}</summary>
          <p className={f.urdu ? 'm-ur-plain' : undefined} lang={f.urdu ? 'ur' : undefined} dir={f.urdu ? 'rtl' : undefined}>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function FinalCta() {
  const cfg = hostConfig();
  return (
    <section className="m-final">
      <div className="m-wrap">
        {/* The mark draws itself once it scrolls into view (marketing.js adds m-draw). */}
        <FinalMark />
        <h2>Take the first step <span className="m-grad">this month.</span></h2>
        <p className="m-lede" style={{ margin: '0 auto' }}>Sign in with Google, set a vault password, and add your first holding or import a statement. About two minutes.</p>
        <div className="m-cta-row"><GoogleCta cfg={cfg} src="home_final">Continue with Google</GoogleCta></div>
      </div>
    </section>
  );
}

function FinalMark() {
  return <LogoMark size={76} markId="mk-final-mark" />;
}

export function MarketingHome() {
  return (
    <MarketingShell page="home">
      <Hero />
      <div className="m-wrap m-brokers">
        <small>Import the statements you already get</small>
        <span>Arif Habib (AHL)</span><span>Finqalab</span><span>JS Global</span><span>Youngs Capital</span><span>Syed Faraz Equities</span><span>+ any broker on the PSX statement template</span>
      </div>
      <Story />
      <Bento />
      <Calculator />
      <PrivacyDemo />
      <Tour />
      <Devices />
      <section className="m-sec" id="pricing-teaser">
        <div className="m-wrap">
          <div className="m-sec-head m-center m-reveal"><span className="m-kicker">Pricing</span><h2>Free while we build it with you.</h2><p className="m-lede">Every feature is open during early access. A paid plan comes later, and we will tell you well before anything changes.</p></div>
          <Plans />
        </div>
      </section>
      <section className="m-sec" id="faq">
        <div className="m-wrap">
          <div className="m-sec-head m-center m-reveal"><span className="m-kicker">Questions</span><h2>Before you start</h2></div>
          <FaqList />
        </div>
      </section>
      <FinalCta />
    </MarketingShell>
  );
}
