/* oxlint-disable next/no-html-link-for-pages -- plain anchors between marketing pages, see shell.tsx */
import type { ReactNode } from 'react';
import { hostConfig } from '@/lib/hosts-server';
import type { SignupSource } from '@/lib/hosts';
import { planChart } from '@/lib/marketing-math';
import { FaqList, Plans } from './home';
import { GoogleCta, Svg } from './parts';
import { MarketingShell } from './shell';
import type { MarketingPage } from '@/lib/marketing-seo';

function PageHero({ kicker, title, lede, children }: { kicker: string; title: ReactNode; lede: string; children?: ReactNode }) {
  return (
    <div className="m-page-hero">
      <div className="m-aurora" aria-hidden="true" />
      <div className="m-wrap">
        <span className="m-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p className="m-lede">{lede}</p>
        {children}
      </div>
    </div>
  );
}

function PageCta({ src, title }: { src: SignupSource; title: string }) {
  const cfg = hostConfig();
  return (
    <section className="m-final" style={{ paddingBlock: '90px 100px' }}>
      <div className="m-wrap">
        <h2 style={{ fontSize: 'clamp(30px,4.6vw,52px)' }}>{title}</h2>
        <div className="m-cta-row"><GoogleCta cfg={cfg} src={src}>Continue with Google</GoogleCta></div>
      </div>
    </section>
  );
}

function Shell({ page, children }: { page: MarketingPage; children: ReactNode }) {
  return <MarketingShell page={page}>{children}</MarketingShell>;
}

export function FeaturesPage() {
  return (
    <Shell page="features">
      <PageHero kicker="Features" title={<>Built around the <span className="m-grad">monthly habit.</span></>} lede="Track everything you own, plan each month, and understand where you stand. All of it works on your device.">
        <div className="m-subnav"><a href="#f-track">Track</a><a href="#f-plan">Plan</a><a href="#f-picks">Monthly Picks</a><a href="#f-insights">Insights</a><a href="#f-import">Import</a><a href="#f-zakat">Zakat</a></div>
      </PageHero>
      <div className="m-wrap">
        <div className="m-feature-row" id="f-track"><div><span className="m-kicker">Track</span><h2>One net worth across six kinds of assets.</h2><p className="m-lede">Stocks, funds, gold and silver, savings plans and foreign currency, in up to four portfolios with an All view on top.</p><ul><li>True average cost, fees and splits</li><li>Dividends booked automatically, with tax</li><li>Company pages with your buys on the chart</li></ul></div>
          <div className="m-fr-vis"><div className="m-card"><div className="m-row"><b>All portfolios</b><span className="m-num">Rs 4,826,350</span></div><div className="m-row"><span>AHL Core</span><span className="m-num">Rs 2,912,400</span></div><div className="m-row"><span>Finqalab</span><span className="m-num">Rs 640,150</span></div><div className="m-row"><span>Savings &amp; Gold</span><span className="m-num">Rs 1,273,800</span></div></div></div></div>
        <div className="m-feature-row" id="f-plan"><div><span className="m-kicker">Plan</span><h2>SIP Blueprint and Future you.</h2><p className="m-lede">Set the monthly amount and the mix. See this month’s progress, your streak, and a projection with what-ifs: a raise, a pause, a market fall.</p></div>
          <div className="m-fr-vis"><Svg viewBox="0 0 400 180" style={{ width: '100%', height: 'auto' }} inner={planChart()} /></div></div>
        <div className="m-feature-row" id="f-picks"><div><span className="m-kicker">Monthly Picks</span><h2>Rank your own shortlist with PSX data.</h2><p className="m-lede">Up to 15 companies you chose, scored from filings and prices on your device. No single pick above 35% of the month.</p></div>
          <div className="m-fr-vis"><div className="m-card"><div className="m-row"><span><span className="m-tick" style={{ background: '#1E3A8A' }}>MEBL</span> Behind target by 4.2%</span><span className="m-num">Rs 17,500</span></div><div className="m-row"><span><span className="m-tick" style={{ background: '#7C2D12' }}>LUCK</span> Strong cash flow</span><span className="m-num">Rs 15,000</span></div><div className="m-row"><span><span className="m-tick" style={{ background: '#065F46' }}>FFC</span> Dividend yield 9.8%</span><span className="m-num">Rs 12,000</span></div></div><p className="m-fine">Illustration. Not advice.</p></div></div>
        <div className="m-feature-row" id="f-insights"><div><span className="m-kicker">Insights</span><h2>Charts that tell you what they mean.</h2><p className="m-lede">Every card leads with a plain sentence. Compare yourself with the KSE-100 and inflation, see income by month and spot concentration.</p></div>
          <div className="m-fr-vis"><div className="m-card"><b>You beat the KSE-100 by 3.1% this year.</b><div className="m-bar" style={{ marginTop: 12 }}><i style={{ width: '82%' }} /></div><div className="m-bar" style={{ marginTop: 8 }}><i style={{ width: '68%', background: 'var(--faint)' }} /></div></div><p className="m-fine">Sample figures.</p></div></div>
        <div className="m-feature-row" id="f-import"><div><span className="m-kicker">Import</span><h2>Your broker statement, read on your device.</h2><p className="m-lede">PDF statements from AHL, Finqalab, JS Global and the PSX template. Review every trade before it is saved.</p></div>
          <div className="m-fr-vis"><div className="m-card"><div className="m-row"><b>14 trades found</b><span className="m-badge m-mint">Ready</span></div><div className="m-row"><span className="m-muted">Holdings match your statement</span><span className="m-up">✓</span></div></div></div></div>
        <div className="m-feature-row" id="f-zakat"><div><span className="m-kicker">Zakat · Beta</span><h2>Zakat on what you actually own.</h2><p className="m-lede">Hijri zakat day, nisab from public silver or gold rates, and payments counted in advance.</p></div>
          <div className="m-fr-vis"><div className="m-card"><div className="m-row"><b>Zakat due 14 Ramadan</b><span className="m-num">Rs 96,420</span></div><div className="m-row"><span className="m-muted">Paid in advance</span><span className="m-num m-up">Rs 40,000</span></div></div><p className="m-fine">Sample figures.</p></div></div>
      </div>
      <PageCta src="features" title="See your own numbers." />
    </Shell>
  );
}

export function SecurityPage() {
  return (
    <Shell page="security">
      <PageHero kicker="Security" title={<>Built so we <span className="m-grad">cannot read it.</span></>} lede="Your ledger is encrypted on your device with a key that only your vault password or recovery key can unlock." />
      <div className="m-wrap" style={{ display: 'grid', gap: 56, paddingBottom: 100 }}>
        <div className="m-flow">
          <div className="m-node"><span className="m-kicker">Your device</span><h3>You enter a trade</h3><p>The ledger is encrypted with AES-256-GCM. The key is wrapped by your vault password (Argon2id) and a recovery key.</p></div>
          <div className="m-link">ciphertext →</div>
          <div className="m-node"><span className="m-kicker">Sipwise server</span><h3>Stores the locked box</h3><p>One encrypted envelope and a version number. No holdings, amounts, budgets or notes.</p></div>
          <div className="m-link">← public prices</div>
          <div className="m-node"><span className="m-kicker">Public data</span><h3>Prices for everyone</h3><p>PSX, MUFAP, metal and currency rates are fetched for all users and combined with your ledger on your device.</p></div>
        </div>
        <div className="m-table-wrap"><table><thead><tr><th>Data</th><th>On your device</th><th>On our server</th></tr></thead><tbody>
          <tr><td>Holdings, trades, amounts</td><td><span className="m-y">Readable</span></td><td><span className="m-n">Encrypted only</span></td></tr>
          <tr><td>Budgets, plans, zakat, notes</td><td><span className="m-y">Readable</span></td><td><span className="m-n">Encrypted only</span></td></tr>
          <tr><td>Your email (for sign-in)</td><td>Yes</td><td>Yes</td></tr>
          <tr><td>Company symbols (to fetch their public prices)</td><td>Yes</td><td>Seen when prices are requested, never with amounts</td></tr>
          <tr><td>Anything sent to an AI</td><td colSpan={2}>Never your portfolio</td></tr>
        </tbody></table></div>
        <p className="m-fine">Read the full <a href="/privacy" style={{ textDecoration: 'underline' }}>privacy policy</a>. If you lose both your vault password and your recovery key, nobody can open the data, including us.</p>
      </div>
      <PageCta src="security" title="Start with a vault only you can open." />
    </Shell>
  );
}

export function GuidePage() {
  return (
    <Shell page="guide">
      <PageHero kicker="Getting started" title={<>Up and running <span className="m-grad">in five steps.</span></>} lede="Watch the two-minute tour on the home page, or follow along here." />
      <div className="m-wrap" style={{ paddingBottom: 100, display: 'grid', gap: 40 }}>
        <ol className="m-steps5">
          <li><b>Sign in with Google</b>It only proves it is you.</li>
          <li><b>Set a vault password</b>This is what locks your data.</li>
          <li><b>Save your recovery key</b>Write it down or keep the file somewhere safe.</li>
          <li><b>Import a statement</b>Or add your first buy by hand.</li>
          <li><b>Set your monthly plan</b>Pick an amount and a mix.</li>
        </ol>
        <div className="m-card" style={{ padding: 24 }}><b>More guides are coming:</b> <span className="m-muted">starting a monthly SIP on PSX, how dividends are taxed for filers, and zakat on shares, in English and Urdu.</span></div>
        <p><a className="m-btn m-btn-ghost" href="/#watch">Watch the video tour</a></p>
      </div>
      <PageCta src="guide" title="Ready for step one?" />
    </Shell>
  );
}

export function PricingPage() {
  return (
    <Shell page="pricing">
      <PageHero kicker="Pricing" title={<>Free during <span className="m-grad">early access.</span></>} lede="No card, no trial clock. Use everything, tell us what you think, and help shape the paid plan." />
      <div className="m-wrap" style={{ paddingBottom: 100 }}>
        <Plans />
        <div style={{ marginTop: 56 }}><FaqList /></div>
      </div>
    </Shell>
  );
}
