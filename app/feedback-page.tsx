'use client';
// Feedback inside the app: Contact us, Report an issue, Suggest a feature. The reply address is prefilled from the
// account; the portfolio is never read (see feedback-form.tsx).
import { useEffect, useState } from 'react';
import { readJson } from '@/lib/safe-json';
import { FeedbackForm } from './feedback-form';

export default function FeedbackPage({ email }: { email: string }) {
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetch('/api/feedback', { cache: 'no-store' })
      .then(readJson)
      .then(
        (b) =>
          live &&
          setSupportEmail(
            (b as { supportEmail?: string | null }).supportEmail ?? null,
          ),
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="fb-wrap">
      <p className="muted">
        Questions, something not working, or an idea? Write to us here. We read
        every message.
      </p>
      <FeedbackForm email={email} supportEmail={supportEmail} />
    </div>
  );
}
