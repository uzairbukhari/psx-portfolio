// Stores MUFAP's fund directory and today's NAVs in the shared `fund_catalog` and `fund_navs` tables (public data, no
// user data). MUFAP publishes every fund's NAV, offer and repurchase price on one public page, in the HTML. History
// builds up from the day this first runs; there is no free source for older prices.
// Env: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (D1 edit permission).
// Usage: node scripts/mufap-nav-scrape.mjs [--dry-run]
import { d1 } from './d1-rest.mjs';
import { parseMufapNavs } from '../lib/mufap.ts';

const dryRun = process.argv.includes('--dry-run');
const URL_ = 'https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=3';
const MIN_FUNDS = 50; // far fewer than the real list means the page changed: fail loudly instead of storing a fragment

const response = await fetch(URL_, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; psx-portfolio-fund-navs)' }, signal: AbortSignal.timeout(60_000) });
if (!response.ok) throw Error(`${response.status} from mufap.com.pk`);
const { catalog, navs } = parseMufapNavs(await response.text());
if (catalog.length < MIN_FUNDS) throw Error(`Only ${catalog.length} funds could be read from MUFAP; the page layout may have changed.`);
const newest = navs.reduce((a, n) => (n.date > a ? n.date : a), '');
console.log(`${catalog.length} funds, newest price date ${newest}`);
if (dryRun) {
  for (const fund of catalog.slice(0, 5)) console.log(fund.mufapId, fund.fundName, navs.find((n) => n.mufapId === fund.mufapId)?.nav);
  process.exit(0);
}

const now = new Date().toISOString();
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
// D1 allows 100 bound values per statement.
for (const part of chunks(catalog, 14))
  await d1(
    `INSERT INTO fund_catalog (mufap_id,amc,fund_name,category,sector,inception_date,updated_at) VALUES ${part.map(() => '(?,?,?,?,?,?,?)').join(',')}
     ON CONFLICT(mufap_id) DO UPDATE SET amc=excluded.amc, fund_name=excluded.fund_name, category=excluded.category, sector=excluded.sector, inception_date=excluded.inception_date, updated_at=excluded.updated_at`,
    part.flatMap((f) => [f.mufapId, f.amc, f.fundName, f.category, f.sector, f.inceptionDate, now]),
  );
for (const part of chunks(navs, 16))
  await d1(
    `INSERT INTO fund_navs (mufap_id,date,nav,offer,repurchase,fetched_at) VALUES ${part.map(() => '(?,?,?,?,?,?)').join(',')}
     ON CONFLICT(mufap_id,date) DO UPDATE SET nav=excluded.nav, offer=excluded.offer, repurchase=excluded.repurchase, fetched_at=excluded.fetched_at`,
    part.flatMap((n) => [n.mufapId, n.date, n.nav, n.offer, n.repurchase, now]),
  );
console.log('Stored.');
