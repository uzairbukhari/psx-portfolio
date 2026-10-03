import { db, failure, requireSuperAdmin } from '@/lib/server';
import { initialPortfolio } from '@/lib/portfolio';
import { addEvent, publicJob, type ResearchJobRow, tickerOK } from '@/lib/research-jobs';
import { sanitizeResearchSettings } from '@/lib/research-settings';
import { UserError } from '@/lib/user-error';

/**
 * Public company details only. The client may name the company (a public fact, sent with the ticker it already
 * sends); otherwise the app's seed list, then the ticker. The server never opens a portfolio to find them, and the
 * browser-side runner verifies the symbol against PSX and sends the authoritative name when it completes.
 */
function resolveCompany(ticker: string, named: { name?: unknown; sector?: unknown }) {
  const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const seeded = initialPortfolio().companies.find((company) => company.ticker === ticker);
  return {
    name: clean(named.name, 150) || seeded?.name || ticker,
    sector: clean(named.sector, 100) || seeded?.sector || 'Unknown',
  };
}

export async function GET(req: Request) {
  try {
    const userId = await requireSuperAdmin(req);
    const rows = await db()
      .prepare(
        'SELECT * FROM research_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
      )
      .bind(userId)
      .all<ResearchJobRow>();
    const url = new URL(req.url);
    // The finished dossier (public company research) for one of this admin's own jobs; the client applies it to
    // its encrypted portfolio. Never returned in the list, which stays small.
    const resultFor = url.searchParams.get('result');
    if (resultFor) {
      const row = rows.results.find((item) => item.id === resultFor);
      if (!row || row.status !== 'complete' || !row.result) throw new UserError('That research result is not available.', 404);
      return Response.json({ result: JSON.parse(row.result) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const selected = url.searchParams.get('job');
    let events: unknown[] = [];
    if (selected) {
      const owns = rows.results.some((row) => row.id === selected);
      if (owns)
        events = (
          await db()
            .prepare(
              'SELECT id,stage,message,created_at FROM research_events WHERE job_id=? ORDER BY id DESC LIMIT 40',
            )
            .bind(selected)
            .all()
        ).results.reverse();
    }
    return Response.json(
      { jobs: rows.results.map((row) => publicJob(row)), events },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireSuperAdmin(req, true);
    const input = (await req.json()) as { ticker?: string; name?: unknown; sector?: unknown; settings?: unknown };
    const ticker = String(input.ticker ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker))
      throw new UserError('Enter a valid PSX ticker using letters and numbers.');
    const existing = await db()
      .prepare(
        "SELECT * FROM research_jobs WHERE user_id=? AND ticker=? AND status IN ('queued','researching','needs_attention') ORDER BY created_at DESC LIMIT 1",
      )
      .bind(userId, ticker)
      .first<ResearchJobRow>();
    if (existing)
      return Response.json({ job: publicJob(existing), existing: true });
    const company = resolveCompany(ticker, input);
    const settings = sanitizeResearchSettings(input.settings);
    const budgetMicros = Math.round(settings.budgetUsd * 1_000_000);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare(
        "INSERT INTO research_jobs (id,user_id,ticker,company_name,sector,status,stage,message,budget_micros,settings,created_at,updated_at) VALUES (?,?,?,?,?,'queued','waiting','Queued',?,?,?,?)",
      )
      .bind(
        id,
        userId,
        ticker,
        company.name,
        company.sector,
        budgetMicros,
        JSON.stringify(settings),
        now,
        now,
      )
      .run();
    await addEvent(
      id,
      'waiting',
      'Dossier queued. Open Research desk to process it.',
    );
    const row = await db()
      .prepare('SELECT * FROM research_jobs WHERE id=?')
      .bind(id)
      .first<ResearchJobRow>();
    return Response.json(
      { job: publicJob(row!), existing: false },
      { status: 201 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const userId = await requireSuperAdmin(req, true);
    const body = (await req.json()) as { id?: string; action?: string };
    const row = await db()
      .prepare('SELECT * FROM research_jobs WHERE id=? AND user_id=?')
      .bind(body.id, userId)
      .first<ResearchJobRow>();
    if (!row) return failure(new UserError('Research job was not found.'), 404);
    const now = new Date().toISOString();
    if (body.action === 'cancel') {
      if (row.status === 'complete' || row.status === 'cancelled')
        throw new UserError('This research job has already finished.');
      if (row.status === 'queued' || row.status === 'needs_attention') {
        await db()
          .prepare(
            "UPDATE research_jobs SET status='cancelled',stage='cancelled',message='Research cancelled',cancel_requested=0,completed_at=?,updated_at=? WHERE id=?",
          )
          .bind(now, now, row.id)
          .run();
        await addEvent(row.id, 'cancelled', 'Queued research was cancelled.');
      } else {
        await db()
          .prepare(
            "UPDATE research_jobs SET cancel_requested=1,message='Cancellation requested',updated_at=? WHERE id=?",
          )
          .bind(now, row.id)
          .run();
        await addEvent(
          row.id,
          row.stage,
          'Cancellation requested. The helper will stop at the next safe checkpoint.',
        );
      }
    } else if (body.action === 'resume') {
      if (row.status !== 'needs_attention')
        throw new UserError('Only paused research can be resumed.');
      if (row.spent_micros >= row.budget_micros)
        throw new UserError(
          'This run has reached its US$0.50 limit. Start a new refresh to spend more.',
        );
      await db()
        .prepare(
          "UPDATE research_jobs SET status='queued',stage='waiting',message='Queued',error=NULL,cancel_requested=0,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?",
        )
        .bind(now, row.id)
        .run();
      await addEvent(
        row.id,
        'waiting',
        'Research resumed within the remaining budget.',
      );
    } else throw new UserError('Unknown research action.');
    const updated = await db()
      .prepare('SELECT * FROM research_jobs WHERE id=?')
      .bind(row.id)
      .first<ResearchJobRow>();
    return Response.json({ job: publicJob(updated!) });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = await requireSuperAdmin(req, true);
    const ticker = String(new URL(req.url).searchParams.get('ticker') ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker))
      throw new UserError('Enter a valid PSX ticker using letters and numbers.');
    const active = await db()
      .prepare(
        "SELECT id FROM research_jobs WHERE user_id=? AND ticker=? AND status IN ('queued','researching') LIMIT 1",
      )
      .bind(userId, ticker)
      .first();
    if (active)
      throw new UserError('Cancel the active research run before deleting it.');
    await db().batch([
      db()
        .prepare(
          'DELETE FROM research_events WHERE job_id IN (SELECT id FROM research_jobs WHERE user_id=? AND ticker=?)',
        )
        .bind(userId, ticker),
      db()
        .prepare('DELETE FROM research_jobs WHERE user_id=? AND ticker=?')
        .bind(userId, ticker),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
