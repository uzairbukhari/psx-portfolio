import { LandingFooter, LandingNav } from '../landing/landing-chrome';

export const metadata = {
  title: 'Privacy policy | Sipwise',
  description: 'How Sipwise handles your data: an encrypted portfolio that only you can read.',
};

export default function Page() {
  return (
    <main className="landing">
      <LandingNav />
      <article className="lp-legal">
        <h1>Privacy policy</h1>
        <p className="updated">Last updated 6 October 2026</p>
        <p>
          Sipwise is a portfolio ledger and planner. This page says what we
          collect and what we cannot see.
        </p>
        <h2>What we receive from Google</h2>
        <p>
          When you sign in with Google we read your name, email address and
          profile picture. The email address identifies your account. We do not
          request access to your Gmail, Drive, contacts or any other Google
          data.
        </p>
        <h2>Your portfolio is encrypted on your device</h2>
        <ul>
          <li>
            Holdings, trades, budgets, notes, shortlists and Monthly Picks
            results are encrypted in your browser or phone before they are sent.
            We store only ciphertext.
          </li>
          <li>
            The key is protected by your vault password and a recovery key shown
            once at setup. We cannot read your data and cannot recover it if
            you lose both.
          </li>
          <li>
            Sipwise never connects to your broker and never places orders.
          </li>
        </ul>
        <h2>What we store in the clear</h2>
        <p>
          Your email, name and picture, your sign-in session, and public market
          data (prices, fund prices, company information, dividend
          announcements) that is the same for every user. If you turn on phone
          notifications, we store a device token and send generic alerts that
          contain no holdings or amounts.
        </p>
        <h2>What we share</h2>
        <p>
          We do not sell your data and do not send private portfolio data to
          advertising, analytics or AI providers. The service runs on
          Cloudflare, which hosts the app and stores the encrypted data.
        </p>
        <h2>Deleting your data</h2>
        <p>
          You can export an encrypted backup or erase your vault from Settings.
          To remove your account details as well, contact us at the address
          below.
        </p>
        <h2>Contact</h2>
        <p>Questions about privacy: suzairbukhari@gmail.com.</p>
      </article>
      <LandingFooter />
    </main>
  );
}
