import { today, type Quote } from '@/lib/portfolio';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function quoteDate(asOf: string) {
  const match = asOf.match(/(?:\w+), (\w+) (\d+), (\d{4})/);
  if (!match || !MONTHS.includes(match[1]))
    throw Error(`Unrecognised quote date "${asOf}"`);
  return `${match[3]}-${String(MONTHS.indexOf(match[1]) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

export async function fetchPsxQuote(ticker: string): Promise<Quote> {
  const source = `https://dps.psx.com.pk/company/${ticker}`;
  const response = await fetch(source, {
    headers: { 'User-Agent': 'Mozilla/5.0 PSX Portfolio Dashboard/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error(`${response.status} from PSX`);
  const text = await response.text();
  const price = Number(
    text.match(/quote__close["'][^>]*>Rs\.\s*([0-9,.]+)/i)?.[1]?.replace(/,/g, ''),
  );
  const asOf = text.match(/quote__date["'][^>]*>\^ As of ([^<]+)/i)?.[1]?.trim();
  if (!Number.isFinite(price) || price <= 0 || !asOf)
    throw Error(`Unexpected PSX quote markup (${text.length} bytes)`);
  const date = quoteDate(asOf);
  if (date > today()) throw Error(`Unexpected future quote date "${date}"`);
  return {
    price,
    asOf,
    date,
    source,
    fetchedAt: new Date().toISOString(),
  };
}
