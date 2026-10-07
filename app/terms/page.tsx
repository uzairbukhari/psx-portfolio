import { LandingFooter, LandingNav } from '../landing/landing-chrome';

export const metadata = {
  title: 'Terms of use | Sipwise',
  description: 'The terms for using Sipwise.',
};

export default function Page() {
  return (
    <main className="landing">
      <LandingNav />
      <article className="lp-legal">
        <h1>Terms of use</h1>
        <p className="updated">Last updated 6 October 2026</p>
        <p>
          By signing in to Sipwise you agree to these terms. They are written to
          be short and plain.
        </p>
        <h2>What Sipwise is</h2>
        <p>
          Sipwise is a tool for recording and viewing your own investments
          (PSX stocks, mutual funds, gold, silver and savings plans) and for
          planning monthly contributions. It does not place orders, hold money
          or connect to your broker.
        </p>
        <h2>Not investment advice</h2>
        <p>
          Monthly Picks, scores, allocations and estimates are informational and
          are ranked on your device from public data. They are not investment,
          tax or legal advice. Prices can be delayed or wrong, and tax figures
          are estimates. Check anything important against your broker and
          official sources before acting.
        </p>
        <h2>Your account and your keys</h2>
        <p>
          You are responsible for your Google account, your vault password and
          your recovery key. Because the portfolio is encrypted on your device,
          we cannot recover it if you lose both.
        </p>
        <h2>Acceptable use</h2>
        <p>
          Do not attempt to disrupt the service, access other people&rsquo;s
          data, or scrape it at scale.
        </p>
        <h2>No warranty</h2>
        <p>
          The service is provided as is, without warranties. To the extent the
          law allows, we are not liable for losses arising from its use or from
          errors in the data it shows.
        </p>
        <h2>Changes and contact</h2>
        <p>
          We may update these terms and will change the date above when we do.
          Questions: <a href="mailto:support@sipwise.trade">support@sipwise.trade</a>.
        </p>
      </article>
      <LandingFooter />
    </main>
  );
}
