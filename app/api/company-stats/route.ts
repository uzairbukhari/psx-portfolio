import { db, failure, identity } from '@/lib/server';
import { readFacts } from '@/lib/company-facts-store';
import { readFaceValues, type FaceValueEvidence } from '@/lib/face-values';
import type { CompanyStats } from '@/lib/company-stats';
import { tickerOK } from '@/lib/research-jobs';
import { UserError } from '@/lib/user-error';
import type { PayoutAnnouncement } from '@/lib/psx-payouts';

/** GET /api/company-stats?ticker=MEBL: public key statistics for the company page. Never reads a portfolio. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const ticker = (new URL(req.url).searchParams.get('ticker') ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker)) throw new UserError('Invalid symbol.');
    const d = db();
    const [[entry], faces, payouts] = await Promise.all([
      readFacts(d, [ticker]),
      readFaceValues(d, [ticker]).catch(
        () => ({}) as Record<string, FaceValueEvidence[]>,
      ),
      d
        .prepare(
          `SELECT kind,percent,per_share_rs,book_closure_start FROM dividend_announcements WHERE ticker=? AND book_closure_start>=?`,
        )
        .bind(
          ticker,
          new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10),
        )
        .all<{
          kind: PayoutAnnouncement['kind'];
          percent: number | null;
          per_share_rs: number | null;
          book_closure_start: string;
        }>()
        .then((r) => r.results)
        .catch(() => []),
    ]);
    const facts = entry?.facts ?? null;
    const stats: CompanyStats = {
      ticker,
      peTtm: facts?.peTtm ?? null,
      marketCap:
        facts?.marketCapThousands != null
          ? facts.marketCapThousands * 1000
          : null,
      week52Low: facts?.week52.low ?? null,
      week52High: facts?.week52.high ?? null,
      payouts: payouts.map((p) => ({
        kind: p.kind,
        percent: p.percent,
        perShareRs: p.per_share_rs,
        bookClosureStart: p.book_closure_start,
      })),
      faceValues: faces[ticker] ?? [],
    };
    return Response.json(
      { stats },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e, undefined, req);
  }
}
