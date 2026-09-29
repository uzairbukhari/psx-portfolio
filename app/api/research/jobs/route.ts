import { db, failure, identity } from '@/lib/server';
import { initialPortfolio } from '@/lib/portfolio';
import {
  addEvent,
  publicJob,
  resolveResearchSettings,
  type ResearchJobRow,
  tickerOK,
} from '@/lib/research-jobs';

async function resolveCompany(ticker: string, userId: string) {
  const saved = await db()
    .prepare('SELECT payload FROM portfolios WHERE user_id=?')
    .bind(userId)
    .first<{ payload: string }>();
  if (saved) {
    const company = JSON.parse(saved.payload).companies?.find(
      (item: { ticker?: string }) => item.ticker === ticker,
    );
    if (company)
      return {
        name: String(company.name || ticker),
        sector: String(company.sector || 'Unknown'),
      };
  }
  const seeded = initialPortfolio().companies.find(
    (company) => company.ticker === ticker,
  );
  // The browser-side research runner verifies unknown symbols against PSX
  // itself and sends the authoritative company name when it completes.
  return { name: seeded?.name || ticker, sector: seeded?.sector || 'Unknown' };
}

export async function GET(req: Request) {
  try {
    const userId = await identity(req);
    const rows = await db()
      .prepare(
        'SELECT * FROM research_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100',
      )
      .bind(userId)
      .all<ResearchJobRow>();
    const selected = new URL(req.url).searchParams.get('job');
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
    const userId = await identity(req, true);
    const input = (await req.json()) as { ticker?: string };
    const ticker = String(input.ticker ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker))
      throw Error('Enter a valid PSX ticker using letters and numbers.');
    const existing = await db()
      .prepare(
        "SELECT * FROM research_jobs WHERE user_id=? AND ticker=? AND status IN ('queued','researching','needs_attention') ORDER BY created_at DESC LIMIT 1",
      )
      .bind(userId, ticker)
      .first<ResearchJobRow>();
    if (existing)
      return Response.json({ job: publicJob(existing), existing: true });
    const company = await resolveCompany(ticker, userId);
    const settings = await resolveResearchSettings(userId);
    const budgetMicros = Math.round(settings.budgetUsd * 1_000_000);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare(
        "INSERT INTO research_jobs (id,user_id,ticker,company_name,sector,status,stage,message,budget_micros,created_at,updated_at) VALUES (?,?,?,?,?,'queued','waiting','Queued',?,?,?)",
      )
      .bind(
        id,
        userId,
        ticker,
        company.name,
        company.sector,
        budgetMicros,
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
    const userId = await identity(req, true);
    const body = (await req.json()) as { id?: string; action?: string };
    const row = await db()
      .prepare('SELECT * FROM research_jobs WHERE id=? AND user_id=?')
      .bind(body.id, userId)
      .first<ResearchJobRow>();
    if (!row) return failure(Error('Research job was not found.'), 404);
    const now = new Date().toISOString();
    if (body.action === 'cancel') {
      if (row.status === 'complete' || row.status === 'cancelled')
        throw Error('This research job has already finished.');
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
        throw Error('Only paused research can be resumed.');
      if (row.spent_micros >= row.budget_micros)
        throw Error(
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
    } else throw Error('Unknown research action.');
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
    const userId = await identity(req, true);
    const ticker = String(new URL(req.url).searchParams.get('ticker') ?? '')
      .trim()
      .toUpperCase();
    if (!tickerOK(ticker))
      throw Error('Enter a valid PSX ticker using letters and numbers.');
    const active = await db()
      .prepare(
        "SELECT id FROM research_jobs WHERE user_id=? AND ticker=? AND status IN ('queued','researching') LIMIT 1",
      )
      .bind(userId, ticker)
      .first();
    if (active)
      throw Error('Cancel the active research run before deleting it.');
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
