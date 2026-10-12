// Synthetic PUBLIC data (market caches, fund prices, gold rates) for the fictional test world, as SQL statements.
// `all` fills an empty sandbox database completely; `gaps` adds only what staging's real scrapers cannot fill
// (the MUFAP fund directory is blocked for GitHub runners, and the test account needs the super_admin role).
// Every statement is INSERT OR IGNORE/REPLACE and fully deterministic for a given `today`.
import { TEST_COMPANIES, TEST_FUNDS, TEST_METAL_RATES } from './universe.ts';
import { TEST_ACCOUNT_EMAIL } from '../test-account.ts';
import { daysAgo } from './account.ts';

const q = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const row = (table: string, mode: string, cols: Record<string, string | number | null>) =>
  `${mode} INTO ${table} (${Object.keys(cols).join(',')}) VALUES (${Object.values(cols).map(q).join(',')});`;

/** Small deterministic pseudo-random generator so history looks real but never changes between runs. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function hash(text: string) {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return h;
}

export type FixtureMode = 'all' | 'gaps';

export function buildPublicFixtureSql(today: string, mode: FixtureMode = 'all', now: Date = new Date()): string[] {
  const at = now.toISOString();
  const ins = mode === 'all' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
  const sql: string[] = [];

  // Funds: directory, a year of prices, payouts. Always written (staging cannot scrape MUFAP).
  for (const f of TEST_FUNDS) {
    sql.push(row('fund_catalog', ins, { mufap_id: f.mufapId, amc: f.amc, fund_name: f.fundName, category: f.category, sector: f.category, inception_date: '2020-01-01', updated_at: at }));
    sql.push(row('tracked_funds', 'INSERT OR IGNORE', { mufap_id: f.mufapId, first_seen: today }));
    const next = rng(hash(f.mufapId));
    for (let i = 0; i <= 400; i += 1) {
      const nav = Math.round(f.nav * (1 - i * 0.0004 + (next() - 0.5) * 0.002) * 10000) / 10000;
      sql.push(row('fund_navs', ins, { mufap_id: f.mufapId, date: daysAgo(today, i), nav, offer: Math.round(nav * (f.offer / f.nav) * 10000) / 10000, repurchase: nav, fetched_at: at }));
    }
  }
  const [moneyMarket] = TEST_FUNDS;
  sql.push(row('fund_payouts', ins, { mufap_id: moneyMarket.mufapId, payout_date: daysAgo(today, 60), per_unit: 1.2, ex_nav: 100, fetched_at: at }));
  sql.push(row('fund_payouts', ins, { mufap_id: moneyMarket.mufapId, payout_date: daysAgo(today, 5), per_unit: 1.1, ex_nav: 101, fetched_at: at }));

  // The test account is a super admin so the Research desk and AI Lab can be tested.
  sql.push(row('user_roles', 'INSERT OR REPLACE', { email: TEST_ACCOUNT_EMAIL, role: 'super_admin', created_at: at }));
  if (mode === 'gaps') return sql;

  // Pak-Qatar sub-fund unit prices.
  for (const id of ['aggressive', 'conservative', 'balanced', 'secure-wealth', 'pure-saving', 'mustehkam-munafa', 'pure-protection', 'kafalat-pension', 'prosperity'])
    for (let i = 0; i <= 120; i += 3) sql.push(row('plan_navs', ins, { fund_id: id, date: daysAgo(today, i), nav: Math.round((150 - i * 0.05 + (hash(id) % 20)) * 100) / 100, fetched_at: at }));

  // Gold and silver, local dealer rate and international spot, for the last 30 days.
  for (let i = 0; i < 30; i++) {
    const wobble = 1 + Math.sin(i / 4) * 0.01;
    for (const [metal, tola] of [['gold', TEST_METAL_RATES.goldPerTola24k], ['silver', TEST_METAL_RATES.silverPerTola]] as const)
      for (const [kind, factor] of [['local', 1], ['international', 0.985]] as const)
        sql.push(row('metal_rates', ins, { date: daysAgo(today, i), metal, kind, pkr_per_tola: Math.round(tola * wobble * factor), source_url: 'https://example.test/metal-rates', source_label: 'Test fixture', fetched_at: at }));
  }

  for (const [index, c] of TEST_COMPANIES.entries()) {
    sql.push(row('security_catalog', ins, {
      ticker: c.ticker, name: c.name, sector: c.sector, security_type: 'equity', source: 'test-fixture', first_seen_at: at, last_seen_at: at,
      sector_name: c.sector, name_source: 'test-fixture', sector_source: 'test-fixture', resolution_status: 'resolved', listing_status: 'listed',
      verified_at: at, profile_fetched_at: at, face_value: c.faceValue, face_value_source: 'test-fixture', face_value_verified_at: at,
    }));
    sql.push(row('security_face_values', ins, { ticker: c.ticker, effective_from: '', face_value: c.faceValue, source_url: 'https://example.test/face-value', source_label: 'Test fixture', evidence: 'Fictional', verified_at: at, status: 'verified' }));
    sql.push(row('quote_refreshes', ins, { ticker: c.ticker, price: c.price, as_of: `${today} 15:30:00`, quote_date: today, source: `https://dps.psx.com.pk/company/${c.ticker}`, fetched_at: at, updated_at: at, observed_at: at }));

    // A year of daily closes, ending at today's price.
    const next = rng(hash(c.ticker));
    const closes: [number, number][] = [];
    let price = c.price;
    for (let i = 0; i < 365; i++) {
      closes.unshift([Math.floor(Date.parse(`${daysAgo(today, i)}T10:00:00Z`) / 1000), Math.round(price * 100) / 100]);
      price = price * (1 - 0.0006 + (next() - 0.5) * 0.03);
    }
    sql.push(row('price_history', ins, { ticker: c.ticker, eod: JSON.stringify(closes), intraday: '[]', eod_fetched_at: at, intraday_fetched_at: null }));

    const eps = Math.round((c.price / (8 + (index % 6))) * 100) / 100;
    const quarters = ['Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026'].map((period, i) => ({ period, revenue: 1000 + i * 40, pat: 200 + i * 10, eps: Math.round((eps / 4) * (1 + i * 0.03) * 100) / 100 }));
    const facts = {
      ticker: c.ticker, name: c.name, sector: c.sector, price: c.price, priceDate: today, peTtm: Math.round((c.price / eps) * 10) / 10,
      week52: { low: Math.round(c.price * 0.7), high: Math.round(c.price * 1.15) }, change1y: 18.5, changeYtd: 7.2, marketCapThousands: c.price * 1e6, freeFloatPct: 35,
      annual: [{ period: '2024', revenue: 3800, pat: 760, eps: eps * 0.9 }, { period: '2025', revenue: 4100, pat: 830, eps }],
      quarterly: quarters,
      ratios: { grossMargin: [40, 41, 42], netMargin: [20, 21, 22], epsGrowth: [8, 10, 12], peg: [1.1, 1, 0.9] },
      announcements: [{ date: daysAgo(today, 20), title: 'Financial results (fictional)', category: 'Financial Results', url: null }],
      source: `https://dps.psx.com.pk/company/${c.ticker}`, fetchedAt: at,
    };
    sql.push(row('company_facts', ins, { ticker: c.ticker, fetched_on: today, payload: JSON.stringify(facts), fetched_at: at }));
  }

  // One cash payout announcement for a held company, so the dividend sync has something to propose.
  sql.push(row('dividend_announcements', ins, {
    ticker: 'OGDC', book_closure_start: daysAgo(today, 5), kind: 'cash', book_closure_end: daysAgo(today, 3), announced_on: daysAgo(today, 25) /* = book closure start + 20 days, matching the seeded expected OGDC dividend */,
    period: 'Q1 2026', details: 'Rs 3 per share (fictional)', percent: null, per_share_rs: 3, fetched_at: at,
  }));
  sql.push(row('ipo_offers', ins, {
    ticker: 'AIRLINK', status: 'found', offer_price: 50, allotment_date: daysAgo(today, 162), listing_date: daysAgo(today, 160),
    evidence: JSON.stringify([{ url: 'https://example.test/ipo', title: 'Final offer document (fictional)' }]), verification: 'curated', reason: null, error: null, checked_at: at,
  }));
  return sql;
}
