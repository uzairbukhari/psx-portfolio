import { LogoMark } from '@/components/logo';
import './landing.css';

/** Branded full-page message used by the error and not-found pages. */
export function ErrorCard({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="load-error">
      <div className="signin-card">
        <LogoMark size={44} />
        <h2>{title}</h2>
        <p className="notice error" role="alert">
          {message}
        </p>
        {action}
        <a className="signin-link" href="/">
          Back to Sipwise
        </a>
      </div>
    </main>
  );
}
