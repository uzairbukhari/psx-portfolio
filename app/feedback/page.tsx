import { env } from 'cloudflare:workers';
import { supportAddress } from '@/lib/feedback';
import { DashboardRoute } from '../dashboard-route';
import { CfBeacon } from '../cf-beacon';
import { FeedbackForm } from '../feedback-form';
import { LandingFooter, LandingNav } from '../landing/landing-chrome';
import '../landing.css';
import '../feedback.css';

export const metadata = {
  title: 'Contact us | Sipwise',
  description:
    'Write to Sipwise: ask a question, report an issue or suggest a feature.',
};

// Signed in: the Feedback page inside the app. Signed out: the same form on a public page, protected by a captcha.
export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <DashboardRoute
      returnTo="/feedback"
      searchParams={searchParams}
      signedOutView={
        <main className="landing">
          <CfBeacon />
          <LandingNav returnTo="/feedback" />
          <article className="fb-public">
            <h1>Contact us</h1>
            <p>
              Ask a question, report an issue or suggest a feature. You do not
              need an account. Your portfolio is encrypted and never part of
              this message.
            </p>
            <FeedbackForm
              siteKey={env.TURNSTILE_SITE_KEY ?? null}
              supportEmail={supportAddress(env.SUPPORT_EMAIL)}
            />
          </article>
          <LandingFooter />
        </main>
      }
    />
  );
}
