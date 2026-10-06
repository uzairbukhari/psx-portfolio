// Mutual fund data from MUFAP (the Mutual Funds Association of Pakistan): the fund directory and each fund's daily
// NAV. Pure: shared by the scraper, the Worker routes and the apps. The page is public and its table is in the HTML.

export type FundCatalogRow = {
  mufapId: string;
  amc: string;
  fundName: string;
  category: string;
  /** Open-End Funds, Voluntary Pension Scheme (VPS), Employer Pension Funds, ETF, and so on. */
  sector: string;
  inceptionDate: string | null;
};
export type FundNavRow = {
  mufapId: string;
  /** The date MUFAP says the price is valid for (YYYY-MM-DD). */
  date: string;
  nav: number;
  /** What you pay to buy; 0 when the fund is not sold through this price (employer pension funds). */
  offer: number;
  /** What you receive on redemption. */
  repurchase: number;
  fetchedAt?: string;
};
export type FundCatalogResponse = {
  funds: (FundCatalogRow & { latest: FundNavRow | null })[];
};
export type FundHistoryResponse = { mufapId: string; navs: FundNavRow[] };

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/** "Oct 05, 2026" to "2026-10-05"; null when it is not a real date. */
export function mufapDate(text: string): string | null {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(
    text.trim(),
  );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const date = `${m[3]}-${month}-${m[2].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? null : date;
}

const decode = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
const price = (text: string) => Number(text.replace(/,/g, ''));

/**
 * Reads the NAV table from the page's HTML. A row needs the fund link (for its MUFAP id), a valid validity date and a
 * NAV above zero; anything else is skipped. The caller should treat a tiny result as a page change and fail loudly.
 */
export function parseMufapNavs(html: string): {
  catalog: FundCatalogRow[];
  navs: FundNavRow[];
} {
  const catalog: FundCatalogRow[] = [];
  const navs: FundNavRow[] = [];
  const seen = new Set<string>();
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const idMatch = /FundID=(\d+)/i.exec(row);
    if (!idMatch) continue;
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) ?? []).map(decode);
    if (cells.length < 9) continue;
    const [
      sector,
      amc,
      fundName,
      category,
      inception,
      offer,
      repurchase,
      nav,
      validity,
    ] = cells;
    const date = mufapDate(validity);
    const navValue = price(nav);
    if (!date || !(navValue > 0) || !fundName || seen.has(idMatch[1])) continue;
    seen.add(idMatch[1]);
    const mufapId = idMatch[1];
    catalog.push({
      mufapId,
      amc,
      fundName,
      category,
      sector,
      inceptionDate: mufapDate(inception),
    });
    navs.push({
      mufapId,
      date,
      nav: navValue,
      offer: price(offer) || 0,
      repurchase: price(repurchase) || navValue,
    });
  }
  return { catalog, navs };
}

/** The price a holder would get today: the redemption price, or the NAV when none is given. */
export const redemptionPrice = (row: Pick<FundNavRow, 'nav' | 'repurchase'>) =>
  row.repurchase > 0 ? row.repurchase : row.nav;

/** Newest row for each fund. */
export function latestNavs(
  rows: FundNavRow[],
  asOf?: string,
): Map<string, FundNavRow> {
  const out = new Map<string, FundNavRow>();
  for (const row of rows) {
    if (asOf && row.date > asOf) continue;
    const current = out.get(row.mufapId);
    if (!current || row.date > current.date) out.set(row.mufapId, row);
  }
  return out;
}
