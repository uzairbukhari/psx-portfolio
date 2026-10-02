import { env } from 'cloudflare:workers';
import { parsePypsxIntraday, type PypsxIntradaySnapshot } from './pypsx-market.ts';
import { createIntradayCache } from './pypsx-cache.ts';

export function pypsxCredentialsFor(user: string) {
  const keyId = env.PYPSX_API_KEY_ID?.trim();
  const secretKey = env.PYPSX_API_SECRET_KEY?.trim();
  const owner = env.PYPSX_OWNER_EMAIL?.trim().toLowerCase();
  if (!keyId || !secretKey || !owner || owner !== user.toLowerCase()) return null;
  // Only free paper-account keys are accepted. This dashboard never connects to
  // pyPSX's live-trading host or exposes credentials to the browser.
  if (!keyId.startsWith('PK_')) return null;
  return { keyId, secretKey };
}

// Keyed by ticker only: the cache is consulted solely after `pypsxCredentialsFor` authorised the
// owner, and the data is public market data, so one owner request warms the next.
const intraday = createIntradayCache({
  async fetchOne(ticker, signal) {
    const keyId = env.PYPSX_API_KEY_ID?.trim();
    const secretKey = env.PYPSX_API_SECRET_KEY?.trim();
    if (!keyId || !secretKey) return null;
    const response = await fetch(`https://paper-api.pypsx.com/intraday/${encodeURIComponent(ticker)}`, {
      headers: { 'PYPSX-API-KEY-ID': keyId, 'PYPSX-API-SECRET-KEY': secretKey },
      signal,
    });
    if (!response.ok) throw Error(`pyPSX intraday request failed for ${ticker} (${response.status}).`);
    return parsePypsxIntraday(await response.json(), ticker);
  },
});

export async function fetchPypsxIntradayFor(
  user: string,
  tickers: string[],
): Promise<Map<string, PypsxIntradaySnapshot>> {
  if (!pypsxCredentialsFor(user) || !tickers.length) return new Map();
  const results = await Promise.all(tickers.map((ticker) => intraday.get(ticker)));
  return new Map(results.flatMap((snapshot) => (snapshot ? [[snapshot.ticker, snapshot] as const] : [])));
}
