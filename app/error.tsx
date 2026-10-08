'use client';

import { useEffect } from 'react';
import { ErrorCard } from './error-card';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorCard
      title="Something went wrong"
      message="This page could not be shown. Your portfolio is safe. Please try again."
      action={<button onClick={reset}>Try again</button>}
    />
  );
}
