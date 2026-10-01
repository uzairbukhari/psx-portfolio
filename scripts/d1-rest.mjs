// Shared D1 REST helpers for the GitHub Actions PSX scrapers.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
export const PROD_DATABASE_ID = 'f72a6264-371b-49ff-89e3-20eef1ce2b19';
// Scrapers target production by default; set D1_DATABASE_ID to aim them at another
// database (the staging D1 database). Scripts that write fake or destructive data
// must call assertStagingDatabase() first.
export const DATABASE_ID = process.env.D1_DATABASE_ID || PROD_DATABASE_ID;

/** Throws unless `id` is set and is not the production database id. */
export function assertStagingDatabase(id = process.env.D1_DATABASE_ID) {
  if (!id || !id.trim()) throw Error('Refusing to run: D1_DATABASE_ID must be set to the staging database id.');
  if (id.trim().toLowerCase() === PROD_DATABASE_ID) throw Error('Refusing to run: D1_DATABASE_ID is the production database.');
  return id.trim();
}

export async function d1(sql, params = []) {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${DATABASE_ID}/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.success)
    throw Error(`D1 query failed (${response.status}): ${JSON.stringify(body.errors ?? body)}`);
  return body.result[0].results;
}

/** Every ticker in any user's portfolio, or the `--tickers=A,B` override. */
export async function heldTickers(tickerArg) {
  if (tickerArg)
    return tickerArg
      .slice('--tickers='.length)
      .split(',')
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker));
  const rows = await d1(
    `SELECT DISTINCT upper(json_extract(c.value, '$.ticker')) AS ticker
     FROM portfolios, json_each(portfolios.payload, '$.companies') AS c`,
  );
  return rows.map((row) => row.ticker).filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker ?? ''));
}
