import type { PortfolioResponse, SavePortfolioResponse } from '@/lib/api-types';
import { db, identity, failure } from '@/lib/server';
import { blankPortfolio, validate, type Portfolio } from '@/lib/portfolio';
import { enrichForSave, overlayForRead } from '@/lib/company-save';
import { dispatchConfig } from '@/lib/dispatch-config';
import { mergeQuotes, readQuoteRows } from '@/lib/quote-cache';
import { readAnnouncements } from '@/lib/dividend-announcements';
import { UserError } from '@/lib/user-error';
import { readLimited } from '@/lib/read-limited';

const MAX_PAYLOAD_BYTES = 4_000_000;
export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const row = await db()
      .prepare('SELECT payload,revision FROM portfolios WHERE user_id=?')
      .bind(user)
      .first<{ payload: string; revision: number }>();
    const portfolio: Portfolio = row
      ? JSON.parse(row.payload)
      : blankPortfolio();
    portfolio.quotes = mergeQuotes(
      portfolio.quotes,
      await readQuoteRows(db()),
      portfolio.companies.map((company) => company.ticker),
    );
    // Resolved company details fill placeholder names/sectors in the response only; nothing is written here,
    // so background lookups never change the revision under an open editor.
    const pendingCompanies = await overlayForRead(db(), portfolio);
    const announcements = await readAnnouncements(
      db(),
      portfolio.companies.map((company) => company.ticker),
    ).catch(() => []);
    return Response.json(
      { portfolio, revision: row?.revision ?? 0, announcements, pendingCompanies } satisfies PortfolioResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(req: Request) {
  try {
    const user = await identity(req, true);
    // Byte limit, checked against content-length first and enforced while streaming.
    const bytes = await readLimited(req, MAX_PAYLOAD_BYTES, 'Portfolio file is too large.');
    const { portfolio, revision, createCompanies } = JSON.parse(new TextDecoder().decode(bytes));
    if (!portfolio || !Array.isArray(portfolio.companies))
      throw new UserError('Invalid portfolio format.');
    if (!Number.isInteger(revision) || revision < 0)
      throw new UserError('Invalid revision.');
    const previousRow = await db()
      .prepare('SELECT payload FROM portfolios WHERE user_id=?')
      .bind(user)
      .first<{ payload: string }>();
    const previous: Portfolio | null = previousRow
      ? JSON.parse(previousRow.payload)
      : null;
    if (createCompanies !== undefined && (!Array.isArray(createCompanies) || createCompanies.length > 25 || createCompanies.some((t) => typeof t !== 'string')))
      throw new UserError('Invalid company list.');
    // Best-effort for imports and old clients (a lookup hiccup never blocks the save); strict for the
    // explicit Add Company intent, which refuses symbols the directory cannot resolve.
    const enriched = await enrichForSave(db(), dispatchConfig(), previous, portfolio, createCompanies ?? []);
    const details = portfolio.companies
      .filter((company: { ticker: string }) => enriched.repaired.includes(company.ticker))
      .map((company: { ticker: string; name: string; sector: string }) => ({ ticker: company.ticker, name: company.name, sector: company.sector }));
    // Validate what is actually stored: after enrichment has filled company facts.
    validate(portfolio);
    const body = JSON.stringify(portfolio),
      now = new Date().toISOString();
    const result =
      revision === 0
        ? await db()
            .prepare(
              'INSERT INTO portfolios (user_id,payload,revision,updated_at) VALUES (?,?,1,?) ON CONFLICT(user_id) DO NOTHING',
            )
            .bind(user, body, now)
            .run()
        : await db()
            .prepare(
              'UPDATE portfolios SET payload=?, revision=revision+1,updated_at=? WHERE user_id=? AND revision=?',
            )
            .bind(body, now, user, revision)
            .run();
    if (!result.meta.changes)
      return failure(
        new UserError('Your portfolio changed in another tab. Reload before saving.'),
        409,
      );
    return Response.json(
      { revision: revision + 1, details, pendingCompanies: enriched.pending } satisfies SavePortfolioResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
