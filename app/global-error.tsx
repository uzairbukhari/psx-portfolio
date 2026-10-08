'use client';

// Replaces the root layout when it fails, so it brings its own html, body and inline styles.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#07101f',
          color: '#e8f0ff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ maxWidth: 380, width: '100%' }}>
          <h2 style={{ fontSize: 26, margin: '0 0 10px' }}>Something went wrong</h2>
          <p style={{ color: '#a4bfdd', lineHeight: 1.6 }}>
            Sipwise could not load. Your portfolio is safe. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              width: '100%',
              padding: 12,
              border: 0,
              borderRadius: 10,
              background: '#3b82f6',
              color: '#fff',
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
