import { identity, failure } from '@/lib/server';
import { today } from '@/lib/portfolio';
export async function POST(req: Request) {
  try {
    await identity(req, true);
    const { tickers } = (await req.json()) as { tickers: string[] };
    if (
      !Array.isArray(tickers) ||
      tickers.length > 200 ||
      tickers.some((t) => !/^[A-Z0-9]{2,12}$/.test(t))
    )
      throw Error('Invalid symbols.');
    const quotes: Record<string, unknown> = {},
      errors: string[] = [];
    for (let i = 0; i < tickers.length; i += 5) {
      await Promise.all(
        tickers.slice(i, i + 5).map(async (ticker) => {
          try {
            const source = 'https://dps.psx.com.pk/company/' + ticker;
            const response = await fetch(source, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(18000),
            });
            if (!response.ok) throw Error();
            const html = await response.text();
            const price = Number(
              html
                .match(/class="quote__close">Rs\.([\d,.]+)/)?.[1]
                ?.replaceAll(',', ''),
            );
            const asOf = html.match(
              /class="quote__date">\^ As of ([^<]+)/,
            )?.[1];
            if (!price || !asOf) throw Error();
            const match = asOf.match(/(?:\w+), (\w+) (\d+), (\d{4})/);
            const months = [
              'Jan',
              'Feb',
              'Mar',
              'Apr',
              'May',
              'Jun',
              'Jul',
              'Aug',
              'Sep',
              'Oct',
              'Nov',
              'Dec',
            ];
            if (!match || !months.includes(match[1])) throw Error();
            const date = `${match[3]}-${String(months.indexOf(match[1]) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
            if (date > today()) throw Error();
            quotes[ticker] = {
              price,
              asOf,
              date,
              source,
              fetchedAt: new Date().toISOString(),
            };
          } catch {
            errors.push(ticker);
          }
        }),
      );
    }
    return Response.json(
      { quotes, errors },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
