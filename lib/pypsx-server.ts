import { env } from 'cloudflare:workers';
import { parsePypsxIntraday, type PypsxIntradaySnapshot } from './pypsx-market';

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

export async function fetchPypsxIntradayFor(
  user: string,
  tickers: string[],
): Promise<Map<string, PypsxIntradaySnapshot>> {
  const credentials = pypsxCredentialsFor(user);
  if (!credentials || !tickers.length) return new Map();
  const retrieved = await Promise.allSettled(
    tickers.map(async (ticker) => {
      const response = await fetch(`https://paper-api.pypsx.com/intraday/${encodeURIComponent(ticker)}`, {
        headers: {
          'PYPSX-API-KEY-ID': credentials.keyId,
          'PYPSX-API-SECRET-KEY': credentials.secretKey,
        },
      });
      if (!response.ok) throw Error(`pyPSX intraday request failed for ${ticker} (${response.status}).`);
      return parsePypsxIntraday(await response.json(), ticker);
    }),
  );
  return new Map(
    retrieved.flatMap((result) =>
      result.status === 'fulfilled' && result.value
        ? [[result.value.ticker, result.value] as const]
        : [],
    ),
  );
}
