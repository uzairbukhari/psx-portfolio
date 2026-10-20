import { db, failure, identity } from '@/lib/server';
import { readFacts } from '@/lib/company-facts-store';
import { readFaceValues } from '@/lib/face-values';
import { today } from '@/lib/portfolio';
import {
  trailingDividendPerShare,
  type CompanyStats,
} from '@/lib/company-stats';
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
      readFaceValues(d, [ticker]).catch(() => ({}) as Record<string, never[]>),
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
    const verified = (faces[ticker] ?? []).filter(
      (f) => f.status === 'verified' || f.status === 'ai',
    );
    const faceValue = verified.length
      ? verified[verified.length - 1].faceValue
      : null;
    const stats: CompanyStats = {
      ticker,
      peTtm: facts?.peTtm ?? null,
      marketCap:
        facts?.marketCapThousands != null
          ? facts.marketCapThousands * 1000
          : null,
      week52Low: facts?.week52.low ?? null,
      week52High: facts?.week52.high ?? null,
      dividendPerShare12m: trailingDividendPerShare(
        payouts.map((p) => ({
          kind: p.kind,
          percent: p.percent,
          perShareRs: p.per_share_rs,
          bookClosureStart: p.book_closure_start,
        })),
        faceValue,
        today(),
      ),
    };
    return Response.json(
      { stats },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e, undefined, req);
  }
}
