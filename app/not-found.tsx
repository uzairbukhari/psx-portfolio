import { ErrorCard } from './error-card';

export const metadata = { title: 'Page not found | Sipwise' };

export default function NotFound() {
  return (
    <ErrorCard
      title="Page not found"
      message="We couldn't find that page. It may have moved, or the link may be wrong."
    />
  );
}
