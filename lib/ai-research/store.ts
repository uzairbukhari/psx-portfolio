// Persistence for the research job. `Query` is the `d1(sql, params)` shape of scripts/d1-rest.mjs, so the same code
// runs against D1's REST API in GitHub Actions and against a SQLite look-alike in tests. Only public tables.
import { overlayQuote, type CompanyFacts } from '../company-facts.ts';
import type { Closes, DividendRow } from './factpack.ts';
import type { CompanyReport, MacroBrief, Ranking, RequestStatus, StoredReport, VerificationStats } from './types.ts';

export type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export type NewsItem = { url: string; ticker: string; publishedOn: string | null; title: string; summary: string };
export type RunStats = Record<string, unknown>;

const parse = <T>(text: unknown): T | null => {
  try { return typeof text === 'string' ? (JSON.parse(text) as T) : null; } catch { return null; }
};

const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export function createStore(query: Query) {
  return {
    async spentSince(startIso: string): Promise<number> {
      const rows = await query('SELECT COALESCE(SUM(cost_usd),0) AS spent FROM ai_research_runs WHERE started_at >= ?', [startIso]);
      return Number(rows[0]?.spent ?? 0);
    },
    async startRun(id: string, startedAt: string, provider: string, models: string) {
      await query("INSERT INTO ai_research_runs (id,started_at,status,provider,models,cost_usd) VALUES (?,?, 'running',?,?,0)", [id, startedAt, provider, models]);
    },
    async updateRunCost(id: string, costUsd: number) {
      await query('UPDATE ai_research_runs SET cost_usd=? WHERE id=?', [costUsd, id]);
    },
    async finishRun(id: string, status: 'completed' | 'failed' | 'capped', costUsd: number, stats: RunStats, error: string | null, finishedAt: string) {
      await query('UPDATE ai_research_runs SET status=?, cost_usd=?, stats=?, error=?, finished_at=? WHERE id=?', [status, costUsd, JSON.stringify(stats), error, finishedAt, id]);
    },

    async loadFacts(ticker: string): Promise<CompanyFacts | null> {
      const rows = await query('SELECT payload FROM company_facts WHERE ticker=?', [ticker]);
      const facts = parse<CompanyFacts>(rows[0]?.payload);
      if (!facts) return null;
      const quote = (await query('SELECT price,quote_date,fetched_at FROM quote_refreshes WHERE ticker=?', [ticker]))[0];
      return overlayQuote(facts, quote && { price: Number(quote.price), quoteDate: String(quote.quote_date), fetchedAt: String(quote.fetched_at) });
    },
    async loadCloses(ticker: string): Promise<Closes> {
      const rows = await query('SELECT eod FROM price_history WHERE ticker=?', [ticker]);
      const pairs = parse<[number, number][]>(rows[0]?.eod) ?? [];
      return pairs.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    },
    async loadDividends(ticker: string): Promise<DividendRow[]> {
      const rows = await query('SELECT announced_on,book_closure_start,per_share_rs,percent,kind FROM dividend_announcements WHERE ticker=? ORDER BY announced_on DESC LIMIT 12', [ticker]);
      return rows.map((r) => ({
        announcedOn: String(r.announced_on), bookClosureStart: String(r.book_closure_start), kind: String(r.kind),
        perShareRs: r.per_share_rs === null ? null : Number(r.per_share_rs), percent: r.percent === null ? null : Number(r.percent),
      }));
    },
    /** P/E (TTM) of every stored company in `sector`, other than `ticker`. */
    async sectorPes(sector: string, ticker: string): Promise<number[]> {
      const rows = await query('SELECT ticker,payload FROM company_facts', []);
      const out: number[] = [];
      for (const row of rows) {
        const facts = parse<CompanyFacts>(row.payload);
        if (facts && facts.sector === sector && facts.ticker !== ticker && facts.peTtm !== null && facts.peTtm > 0) out.push(facts.peTtm);
      }
      return out;
    },

    async getMacro(month: string): Promise<MacroBrief | null> {
      return parse<MacroBrief>((await query('SELECT payload FROM ai_macro_briefs WHERE month=?', [month]))[0]?.payload);
    },
    async latestMacro(): Promise<MacroBrief | null> {
      return parse<MacroBrief>((await query('SELECT payload FROM ai_macro_briefs ORDER BY month DESC LIMIT 1', []))[0]?.payload);
    },
    async putMacro(brief: MacroBrief, model: string, now: string) {
      await query('INSERT OR REPLACE INTO ai_macro_briefs (month,payload,model,created_at) VALUES (?,?,?,?)', [brief.month, JSON.stringify(brief), model, now]);
    },

    async getProfile(ticker: string): Promise<{ payload: unknown; createdAt: string } | null> {
      const row = (await query('SELECT payload,created_at FROM ai_company_profiles WHERE ticker=?', [ticker]))[0];
      return row ? { payload: parse<unknown>(row.payload), createdAt: String(row.created_at) } : null;
    },
    async putProfile(ticker: string, payload: unknown, model: string, now: string) {
      await query('INSERT OR REPLACE INTO ai_company_profiles (ticker,payload,model,created_at) VALUES (?,?,?,?)', [ticker, JSON.stringify(payload), model, now]);
    },

    async getExtract(ticker: string, docKey: string): Promise<unknown> {
      return parse<unknown>((await query('SELECT payload FROM ai_financial_extracts WHERE ticker=? AND doc_key=?', [ticker, docKey]))[0]?.payload);
    },
    async recentExtracts(ticker: string, limit = 3): Promise<{ docKey: string; period: string | null; payload: unknown }[]> {
      const rows = await query('SELECT doc_key,period,payload FROM ai_financial_extracts WHERE ticker=? ORDER BY created_at DESC LIMIT ?', [ticker, limit]);
      return rows.map((r) => ({ docKey: String(r.doc_key), period: optStr(r.period), payload: parse<unknown>(r.payload) }));
    },
    async putExtract(ticker: string, docKey: string, period: string | null, payload: unknown, model: string, now: string) {
      await query('INSERT OR REPLACE INTO ai_financial_extracts (ticker,doc_key,period,payload,model,created_at) VALUES (?,?,?,?,?,?)', [ticker, docKey, period, JSON.stringify(payload), model, now]);
    },

    async recentNews(ticker: string, sinceDate: string): Promise<NewsItem[]> {
      const rows = await query('SELECT url,ticker,published_on,title,summary FROM ai_news_items WHERE ticker=? AND COALESCE(published_on, created_at) >= ? ORDER BY COALESCE(published_on, created_at) DESC LIMIT 12', [ticker, sinceDate]);
      return rows.map((r) => ({ url: String(r.url), ticker: String(r.ticker), publishedOn: optStr(r.published_on), title: String(r.title), summary: String(r.summary) }));
    },
    async putNews(items: NewsItem[], now: string) {
      for (const item of items)
        await query('INSERT OR IGNORE INTO ai_news_items (url,ticker,published_on,title,summary,created_at) VALUES (?,?,?,?,?,?)', [item.url, item.ticker, item.publishedOn, item.title.slice(0, 300), item.summary.slice(0, 1200), now]);
    },

    async getReport(ticker: string): Promise<StoredReport | null> {
      const row = (await query('SELECT * FROM ai_company_research WHERE ticker=?', [ticker]))[0];
      return row ? rowToReport(row) : null;
    },
    async putReport(stored: StoredReport) {
      const payload = JSON.stringify({ report: stored.report, verification: stored.verification });
      await query(
        'INSERT OR REPLACE INTO ai_company_research (ticker,payload,inputs_hash,price_at_report,researched_at,checked_at,carried_forward,model) VALUES (?,?,?,?,?,?,?,?)',
        [stored.ticker, payload, stored.inputsHash, stored.priceAtReport, stored.researchedAt, stored.checkedAt, stored.carriedForward ? 1 : 0, stored.model],
      );
    },
    async touchReport(ticker: string, checkedAt: string, carried: boolean) {
      await query('UPDATE ai_company_research SET checked_at=?, carried_forward=? WHERE ticker=?', [checkedAt, carried ? 1 : 0, ticker]);
    },
    async reportsFor(tickers: string[]): Promise<StoredReport[]> {
      if (!tickers.length) return [];
      const rows = await query(`SELECT * FROM ai_company_research WHERE ticker IN (${tickers.map(() => '?').join(',')})`, tickers);
      return rows.map(rowToReport).filter((r): r is StoredReport => r !== null);
    },

    async getRanking(month: string, tickersHash: string): Promise<{ ranking: Ranking; createdAt: string } | null> {
      const row = (await query('SELECT payload,created_at FROM ai_rankings WHERE id=?', [`${month}:${tickersHash}`]))[0];
      const ranking = parse<Ranking>(row?.payload);
      return ranking ? { ranking, createdAt: String(row.created_at) } : null;
    },
    async putRanking(ranking: Ranking, prices: Record<string, number | null>, model: string, now: string) {
      await query('INSERT OR REPLACE INTO ai_rankings (id,month,tickers_hash,payload,prices,model,created_at) VALUES (?,?,?,?,?,?,?)',
        [`${ranking.month}:${ranking.tickersHash}`, ranking.month, ranking.tickersHash, JSON.stringify(ranking), JSON.stringify(prices), model, now]);
    },

    async recentRankings(limit = 12): Promise<{ ranking: Ranking; createdAt: string }[]> {
      const rows = await query('SELECT payload,created_at FROM ai_rankings ORDER BY created_at DESC LIMIT ?', [limit]);
      return rows.flatMap((r) => { const ranking = parse<Ranking>(r.payload); return ranking ? [{ ranking, createdAt: String(r.created_at) }] : []; });
    },
    async requestsFor(tickers: string[]): Promise<{ ticker: string; status: RequestStatus; error: string | null; requestedAt: string; startedAt: string | null }[]> {
      if (!tickers.length) return [];
      const rows = await query(`SELECT ticker,status,error,requested_at,started_at FROM ai_research_requests WHERE ticker IN (${tickers.map(() => '?').join(',')})`, tickers);
      return rows.map((r) => ({ ticker: String(r.ticker), status: String(r.status) as RequestStatus, error: optStr(r.error), requestedAt: String(r.requested_at), startedAt: optStr(r.started_at) }));
    },
    /** Queues tickers for the next run. A ticker already researching keeps that status. */
    async queueRequests(tickers: string[], now: string) {
      for (const ticker of tickers)
        await query(
          `INSERT INTO ai_research_requests (ticker,requested_at,status) VALUES (?,?,'queued')
           ON CONFLICT(ticker) DO UPDATE SET requested_at=excluded.requested_at,
             status=CASE WHEN ai_research_requests.status='researching' THEN 'researching' ELSE 'queued' END,
             error=NULL`,
          [ticker, now],
        );
    },
    async latestMacroBrief(): Promise<MacroBrief | null> { return this.latestMacro(); },
    async pendingRequests(): Promise<string[]> {
      const rows = await query("SELECT ticker FROM ai_research_requests WHERE status IN ('queued','researching') ORDER BY requested_at", []);
      return rows.map((r) => String(r.ticker));
    },
    /** Tickers requested in the last `days` days: the monthly refresh covers them without anyone pressing a button. */
    async recentRequests(sinceIso: string): Promise<string[]> {
      const rows = await query('SELECT ticker FROM ai_research_requests WHERE requested_at >= ? ORDER BY requested_at', [sinceIso]);
      return rows.map((r) => String(r.ticker));
    },
    async setRequestStatus(ticker: string, status: RequestStatus, now: string, error: string | null = null) {
      await query(
        `INSERT INTO ai_research_requests (ticker,requested_at,status,started_at,finished_at,error) VALUES (?,?,?,?,?,?)
         ON CONFLICT(ticker) DO UPDATE SET status=excluded.status, error=excluded.error,
           started_at=COALESCE(excluded.started_at, ai_research_requests.started_at),
           finished_at=excluded.finished_at`,
        [ticker, now, status, status === 'researching' ? now : null, status === 'ready' || status === 'failed' ? now : null, error],
      );
    },
  };
}
export type ResearchStore = ReturnType<typeof createStore>;

function rowToReport(row: Record<string, unknown>): StoredReport | null {
  const body = parse<{ report: CompanyReport; verification: VerificationStats }>(row.payload);
  if (!body?.report) return null;
  return {
    ticker: String(row.ticker), report: body.report, verification: body.verification ?? { claims: 0, verified: 0, dropped: 0, convictionPenalty: 0 },
    inputsHash: String(row.inputs_hash), priceAtReport: row.price_at_report === null ? null : Number(row.price_at_report),
    researchedAt: String(row.researched_at), checkedAt: String(row.checked_at), carriedForward: Number(row.carried_forward) === 1, model: String(row.model),
  };
}
