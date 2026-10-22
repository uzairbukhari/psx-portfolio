'use client';
// The Contact us / Report an issue / Suggest a feature form. Used inside the app (signed in, email prefilled) and on the
// public /feedback page (signed out, Turnstile captcha). It sends only what is typed here plus the page it was opened
// from: it never reads the portfolio.
import { useEffect, useRef, useState } from 'react';
import { Bug, CheckCircle2, Lightbulb, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  FEEDBACK_MAX_MESSAGE,
  FEEDBACK_MIN_MESSAGE,
  type FeedbackKind,
} from '@/lib/feedback';
import { readJson } from '@/lib/safe-json';
import { track } from './analytics';

const KINDS: {
  kind: FeedbackKind;
  label: string;
  hint: string;
  placeholder: string;
  Icon: typeof Bug;
}[] = [
  {
    kind: 'contact',
    label: 'Contact us',
    hint: 'A question or anything else',
    placeholder: 'What would you like to ask or tell us?',
    Icon: MessageCircle,
  },
  {
    kind: 'issue',
    label: 'Report an issue',
    hint: 'Something is broken or wrong',
    placeholder:
      'What happened, and what did you expect? Which page were you on?',
    Icon: Bug,
  },
  {
    kind: 'feature',
    label: 'Suggest a feature',
    hint: 'An idea to make Sipwise better',
    placeholder: 'What would you like Sipwise to do, and why would it help?',
    Icon: Lightbulb,
  },
];

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-turnstile]',
    );
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve(window.turnstile ?? null));
    script.addEventListener('error', () => resolve(null));
    if (!existing) {
      script.src =
        'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.dataset.turnstile = '1';
      document.head.appendChild(script);
    }
  });
}

export function FeedbackForm({
  email,
  siteKey,
  supportEmail,
  initialKind = 'contact',
}: {
  /** The signed-in account's email (prefills the reply address); omitted on the public page. */
  email?: string;
  /** Turnstile site key; required when signed out. */
  siteKey?: string | null;
  supportEmail?: string | null;
  initialKind?: FeedbackKind;
}) {
  const signedIn = !!email; // an empty string means no account, as on the public page
  const [kind, setKind] = useState<FeedbackKind>(initialKind);
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState(email ?? '');
  const [website, setWebsite] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const current = KINDS.find((k) => k.kind === kind)!;
  const needsCaptcha = !signedIn;
  const unavailable = needsCaptcha && !siteKey;

  useEffect(() => {
    if (!needsCaptcha || !siteKey || sent) return;
    let gone = false;
    void loadTurnstile().then((api) => {
      if (gone || !api || !box.current) return;
      widget.current = api.render(box.current, {
        sitekey: siteKey,
        callback: (token: string) => setCaptcha(token),
        'expired-callback': () => setCaptcha(''),
        'error-callback': () => setCaptcha(''),
      });
    });
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [needsCaptcha, siteKey, sent]);

  const long = message.trim().length >= FEEDBACK_MIN_MESSAGE;
  const ready = long && !busy && !unavailable && (!needsCaptcha || !!captcha);

  async function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          message,
          contactEmail: reply,
          website,
          captcha,
          page: window.location.pathname,
          platform: 'web',
        }),
      });
      const body = (await readJson(res)) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not send. Try again.');
      track('feedback_sent', { kind });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not send. Try again.',
      );
      if (widget.current) window.turnstile?.reset(widget.current);
      setCaptcha('');
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <output className="fb-done">
        <CheckCircle2 size={28} aria-hidden="true" />
        <h2>Thank you, we got it</h2>
        <p>
          {reply
            ? `If we need to ask something, we will write to ${reply}.`
            : 'You did not leave an email, so we cannot reply to this one.'}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setMessage('');
            setCaptcha('');
            setSent(false);
          }}
        >
          Send another
        </Button>
      </output>
    );

  return (
    <form className="fb-form" onSubmit={submit} noValidate>
      <fieldset className="fb-kinds" aria-label="What would you like to send?">
        {KINDS.map(({ kind: k, label, hint, Icon }) => (
          <button
            key={k}
            type="button"
            data-slot="fb-kind"
            aria-pressed={k === kind}
            className="fb-kind"
            onClick={() => setKind(k)}
          >
            <Icon size={18} aria-hidden="true" />
            <b>{label}</b>
            <small>{hint}</small>
          </button>
        ))}
      </fieldset>
      <label className="fb-field" htmlFor="fb-message">
        <span>Your message</span>
        <Textarea
          id="fb-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={current.placeholder}
          rows={7}
          maxLength={FEEDBACK_MAX_MESSAGE}
          required
        />
        <small className="fb-count">
          {message.trim().length} / {FEEDBACK_MAX_MESSAGE}
        </small>
      </label>
      <label className="fb-field" htmlFor="fb-reply">
        <span>
          Email for a reply <em>(optional)</em>
        </span>
        <Input
          id="fb-reply"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="you@example.com"
        />
      </label>
      {/* Honeypot: hidden from people and screen readers; bots fill it. */}
      <input
        className="fb-trap"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      <p className="fb-note">
        {signedIn
          ? 'We send only what you type here and the page you are on. Nothing from your encrypted portfolio is read or sent, so do not paste holdings or amounts.'
          : 'Please do not include holdings, amounts or passwords. Your portfolio is encrypted and we cannot see it.'}
      </p>
      {needsCaptcha &&
        (siteKey ? (
          <div ref={box} className="fb-captcha" />
        ) : (
          <p role="alert" className="fb-error">
            Sending without signing in is not available yet. Sign in to send
            this{supportEmail ? ` or write to ${supportEmail}` : ''}.
          </p>
        ))}
      {error && (
        <p role="alert" className="fb-error">
          {error}
        </p>
      )}
      <div className="fb-actions">
        <Button type="submit" disabled={!ready}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
        {supportEmail && (
          <a className="fb-mail" href={`mailto:${supportEmail}`}>
            or email {supportEmail}
          </a>
        )}
      </div>
    </form>
  );
}
