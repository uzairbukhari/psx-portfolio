// A `Server-Timing` header for the data routes, so DevTools shows how long the Worker spent (mostly D1 reads) and how
// many rows came back. Numbers only: no ticker, user or amount is ever put in it.
export function serverTiming(startedAt: number, rows?: number): Record<string, string> {
  const parts = [`total;dur=${Math.max(0, Date.now() - startedAt)}`];
  if (rows !== undefined) parts.push(`rows;desc="rows returned";dur=${rows}`);
  return { 'Server-Timing': parts.join(', ') };
}
