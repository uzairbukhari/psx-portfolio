// The monthly research job, end to end, with the model, the store and the network injected so it can be tested with
// fakes. Order of work: macro brief once a month, then per company (reuse rule first, then profile, filing extract
// and company report only when needed), bear review for the top names, and one ranking pass. Every model call is
// reserved against the monthly cap before it is made.
import { CapReachedError, Ledger, monthKey } from './ledger.ts';
import { costOf, estimateTokens, outputCeiling, resolveConfig, worstCaseCost, type AiConfig } from './models.ts';
import { PROMPTS, SCHEMAS, SOURCE_ALLOWLIST } from './prompts.ts';
import { buildFactPack, median, stableFactsKey } from './factpack.ts';
import { decideReuse, reportUsable, sha256Hex } from './reuse.ts';
import { verifyReport, type SeenSources } from './verify.ts';
import { type AiProvider, type AiRequest } from './provider.ts';
import type { ResearchStore } from './store.ts';
import type { CompanyReport, FactPack, MacroBrief, Ranking, RankingEntry, ReuseDecision, StoredReport } from './types.ts';

export type PipelineIo = {
  /** Plain text of a web page or PDF, or null when it cannot be read. Used for filings and for quote verification. */
  fetchText(url: string): Promise<string | null>;
  now(): Date;
  log(message: string): void;
};
export type PipelineInput = {
  store: ResearchStore;
  provider: AiProvider;
  config: AiConfig;
  io: PipelineIo;
  tickers: string[];
  runId: string;
  /** Rewrite reports even when nothing changed. */
  force?: boolean;
};
export type CompanyOutcome = { ticker: string; decision: ReuseDecision | 'failed' | 'skipped'; note?: string };
export type PipelineResult = {
  status: 'completed' | 'capped' | 'failed';
  costUsd: number;
  outcomes: CompanyOutcome[];
  ranked: number;
  error: string | null;
  calls: number;
};

const PROFILE_MAX_AGE_DAYS = 183;
const NEWS_WINDOW_DAYS = 90;
const MAX_FETCHES_PER_COMPANY = 8;
const RANK_MAX_OUTPUT = 6000;
const COMPANY_MAX_OUTPUT = 7000;

const daysBetween = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / 86_400_000;
const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

export async function runResearch(input: PipelineInput): Promise<PipelineResult> {
  const { store, provider, config, io, runId } = input;
  const now = io.now();
  const month = monthKey(now);
  const startIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const ledger = new Ledger(config.monthlyCapUsd, await store.spentSince(startIso));
  const outcomes: CompanyOutcome[] = [];
  let calls = 0;
  let capped = false;

  /** One model call under the cap. Returns null when the cap blocks it; throws other errors. */
  async function call(request: AiRequest, ignoreHold = false) {
    const model = config.models[request.role];
    const worst = worstCaseCost(model, estimateTokens(request.system + request.input), outputCeiling(config, request.role, request.maxOutputTokens), request.webSearch?.maxUses ?? 0);
    let settle: (usd: number | null) => void;
    try { settle = ledger.reserve(worst, ignoreHold); } catch (error) {
      if (error instanceof CapReachedError) { capped = true; io.log(`cap: skipping ${request.stage} ($${worst.toFixed(3)} would exceed the monthly cap)`); return null; }
      throw error;
    }
    try {
      const response = await provider.call(request);
      calls += 1;
      settle(costOf(response.model, response.usage));
      await store.updateRunCost(runId, ledger.costThisRun).catch(() => {});
      return response;
    } catch (error) {
      settle(null);
      throw error;
    }
  }

  // Keep money back for the ranking so company reports cannot use the whole budget.
  ledger.setHold(worstCaseCost(config.models.rank, 6000 + input.tickers.length * 900, outputCeiling(config, 'rank', RANK_MAX_OUTPUT), 0));

  // 1. Macro brief: once a month, reused by every company call.
  let macro = await store.getMacro(month);
  if (!macro) {
    try {
      const response = await call({
        stage: 'macro', role: 'read', system: PROMPTS.macro, schemaName: 'macro_brief', schema: SCHEMAS.macro,
        input: `Month: ${month}. Today is ${now.toISOString().slice(0, 10)}.`, maxOutputTokens: 3500,
        webSearch: { maxUses: 5, domains: SOURCE_ALLOWLIST },
      });
      if (response) {
        const body = asRecord(response.json);
        macro = { ...(body as unknown as MacroBrief), month };
        await store.putMacro(macro, response.model, now.toISOString());
      }
    } catch (error) { io.log(`macro brief failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
  macro ??= await store.latestMacro();

  // 2. Companies, three at a time.
  const queue = [...new Set(input.tickers)];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    for (let ticker = queue.shift(); ticker; ticker = queue.shift()) {
      try { outcomes.push(await researchCompany(ticker)); } catch (error) {
        const note = error instanceof Error ? error.message : String(error);
        io.log(`${ticker}: failed - ${note}`);
        outcomes.push({ ticker, decision: 'failed', note });
      }
    }
  });
  await Promise.all(workers);

  async function researchCompany(ticker: string): Promise<CompanyOutcome> {
    const facts = await store.loadFacts(ticker);
    if (!facts) return { ticker, decision: 'skipped', note: 'No PSX company data stored for this ticker yet.' };
    const asOf = now.toISOString().slice(0, 10);
    const [closes, dividends, sectorPes, stored, news, extracts] = await Promise.all([
      store.loadCloses(ticker), store.loadDividends(ticker), store.sectorPes(facts.sector, ticker),
      store.getReport(ticker), store.recentNews(ticker, new Date(now.getTime() - NEWS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)),
      store.recentExtracts(ticker),
    ]);
    const peers = sectorPes.length >= 3 ? median(sectorPes) : null;
    const pack = buildFactPack({ facts, closes, dividends, sectorMedianPe: peers, asOf });
    const inputsHash = await sha256Hex(`${stableFactsKey(pack)}|${pack.latestFilingUrl ?? ''}|${news.map((n) => n.url).sort().join(',')}`);
    const decision = decideReuse({ stored, inputsHash, price: pack.price, now, force: input.force });
    if (decision === 'fresh') return { ticker, decision };
    if (decision === 'carry') {
      await store.touchReport(ticker, now.toISOString(), true);
      return { ticker, decision };
    }

    const fetched = new Map<string, string>();
    const seen: SeenSources = new Map();
    for (const item of news) seen.set(item.url, `${item.title}. ${item.summary}`);
    for (const a of pack.announcements) if (a.url) seen.set(a.url, a.title);

    // Profile: durable, rebuilt rarely.
    let profile = await store.getProfile(ticker);
    if (!profile || daysBetween(profile.createdAt, now) > PROFILE_MAX_AGE_DAYS) {
      const response = await call({
        stage: `profile:${ticker}`, role: 'read', system: PROMPTS.profile, schemaName: 'company_profile', schema: SCHEMAS.profile,
        input: `Company: ${pack.name} (${ticker}), sector ${pack.sector}, on the Pakistan Stock Exchange.\n${factLines(pack)}`,
        maxOutputTokens: 2500, webSearch: { maxUses: 3, domains: SOURCE_ALLOWLIST },
      });
      if (response) {
        await store.putProfile(ticker, response.json, response.model, now.toISOString());
        profile = { payload: response.json, createdAt: now.toISOString() };
        for (const s of response.sources) if (!seen.has(s.url)) seen.set(s.url, '');
      }
    }

    // New filing: read once, stored by document key.
    if (pack.latestFilingUrl) {
      const docKey = await sha256Hex(pack.latestFilingUrl);
      if (!(await store.getExtract(ticker, docKey))) {
        const text = await io.fetchText(pack.latestFilingUrl).catch(() => null);
        if (text && text.trim().length > 200) {
          seen.set(pack.latestFilingUrl, text);
          const response = await call({
            stage: `filing:${ticker}`, role: 'read', system: PROMPTS.filing, schemaName: 'filing_extract', schema: SCHEMAS.filing,
            input: `Company: ${pack.name} (${ticker}).\nDocument text (may be truncated):\n${text.slice(0, 60_000)}`, maxOutputTokens: 2500,
          });
          if (response) {
            const period = typeof asRecord(response.json).period === 'string' ? String(asRecord(response.json).period) : null;
            await store.putExtract(ticker, docKey, period, response.json, response.model, now.toISOString());
            extracts.unshift({ docKey, period, payload: response.json });
          }
        }
      }
    }

    // The report itself.
    const response = await call({
      stage: `company:${ticker}`, role: 'read', system: PROMPTS.company, schemaName: 'company_report', schema: SCHEMAS.company,
      input: companyInput({ pack, profile: profile?.payload, extracts, news, macro, previous: stored?.report }),
      maxOutputTokens: COMPANY_MAX_OUTPUT, webSearch: { maxUses: 3, domains: SOURCE_ALLOWLIST },
    });
    if (!response) return { ticker, decision: 'skipped', note: 'Monthly AI cap reached before this company could be researched.' };
    const body = asRecord(response.json) as unknown as CompanyReport & { newNews?: { url: string; date: string; title: string; summary: string }[] };
    const { newNews = [], ...draft } = body;
    for (const s of response.sources) if (!seen.has(s.url)) seen.set(s.url, '');
    await store.putNews(newNews.filter((n) => /^https?:\/\//.test(n.url)).map((n) => ({
      url: n.url, ticker, publishedOn: /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : null, title: n.title, summary: n.summary,
    })), now.toISOString());
    for (const n of newNews) if (n.url && !seen.get(n.url)) seen.set(n.url, `${n.title}. ${n.summary}`);

    // Read the cited pages so quotes can be checked in code (red flags and evidence only).
    const cited = [...new Set([...draft.evidence.map((e) => e.sourceUrl), ...draft.holdingView.redFlags.map((f) => f.sourceUrl)])]
      .filter((u) => u && u.startsWith('https://') && !fetched.has(u) && !(seen.get(u))).slice(0, MAX_FETCHES_PER_COMPANY);
    for (const url of cited) {
      const text = await io.fetchText(url).catch(() => null);
      if (text) { fetched.set(url, text); seen.set(url, text); }
    }

    const { report, stats } = verifyReport(draft, pack, seen);
    const storedReport: StoredReport = {
      ticker, report, inputsHash, priceAtReport: pack.price, researchedAt: now.toISOString(), checkedAt: now.toISOString(),
      carriedForward: false, model: response.model, verification: stats,
    };
    await store.putReport(storedReport);
    return { ticker, decision };
  }

  // 3. Bear review of the top five by conviction, only for reports written this run.
  const rewritten = new Set(outcomes.filter((o) => o.decision === 'full' || o.decision === 'update').map((o) => o.ticker));
  const candidates = (await store.reportsFor([...rewritten])).sort((a, b) => b.report.conviction - a.report.conviction).slice(0, 5);
  for (const candidate of candidates) {
    try {
      const facts = await store.loadFacts(candidate.ticker);
      if (!facts) continue;
      const pack = buildFactPack({ facts, closes: await store.loadCloses(candidate.ticker), dividends: [], sectorMedianPe: null, asOf: now.toISOString().slice(0, 10) });
      const response = await call({
        stage: `bear:${candidate.ticker}`, role: 'read', system: PROMPTS.bear, schemaName: 'bear_review', schema: SCHEMAS.bear,
        input: `Fact pack:\n${factLines(pack)}\n\nDraft report:\n${JSON.stringify(candidate.report)}`, maxOutputTokens: 1500,
      });
      if (!response) break;
      const review = asRecord(response.json);
      const adjust = Math.max(-20, Math.min(0, Math.round(Number(review.convictionAdjustment) || 0)));
      const note = typeof review.strongestCase === 'string' ? review.strongestCase.slice(0, 1500) : undefined;
      await store.putReport({ ...candidate, report: { ...candidate.report, conviction: Math.max(0, candidate.report.conviction + adjust), bearReviewNote: note } });
    } catch (error) { io.log(`${candidate.ticker}: bear review failed - ${error instanceof Error ? error.message : String(error)}`); }
  }

  // 4. Ranking over every usable report for the requested tickers.
  const all = await store.reportsFor(input.tickers);
  const usable = all.filter((r) => reportUsable(r, now));
  const excluded = input.tickers.filter((t) => !usable.some((r) => r.ticker === t)).map((ticker) => ({
    ticker, reason: all.some((r) => r.ticker === ticker) ? 'Research is out of date or failed verification.' : 'No AI research yet.',
  }));
  let ranked = 0;
  if (usable.length) {
    const tickersHash = (await sha256Hex(usable.map((r) => `${r.ticker}:${r.researchedAt}:${r.report.conviction}`).sort().join('|'))).slice(0, 16);
    if (!(await store.getRanking(month, tickersHash))) {
      try {
        const response = await call({
          stage: 'rank', role: 'rank', system: PROMPTS.rank, schemaName: 'ranking', schema: SCHEMAS.rank,
          input: `Macro brief:\n${JSON.stringify(macro ?? {})}\n\nReports:\n${usable.map((r) => compactReport(r)).join('\n')}`,
          maxOutputTokens: RANK_MAX_OUTPUT,
        }, true);
        if (response) {
          const ranking = cleanRanking(response.json, usable.map((r) => r.ticker), month, tickersHash, excluded);
          const prices: Record<string, number | null> = Object.fromEntries(usable.map((r) => [r.ticker, r.priceAtReport]));
          await store.putRanking(ranking, prices, response.model, now.toISOString());
          ranked = ranking.entries.length;
        }
      } catch (error) { io.log(`ranking failed - ${error instanceof Error ? error.message : String(error)}`); }
    } else ranked = usable.length;
  }

  const failed = outcomes.filter((o) => o.decision === 'failed').length;
  return {
    status: capped ? 'capped' : failed && failed === outcomes.length ? 'failed' : 'completed',
    costUsd: ledger.costThisRun, outcomes, ranked, calls,
    error: failed ? `${failed} of ${outcomes.length} companies failed.` : null,
  };
}

function factLines(pack: FactPack): string {
  return Object.entries(pack.facts).filter(([, f]) => f.value !== null).map(([key, f]) => `${key}: ${f.value} (${f.label})`).join('\n');
}

function companyInput(a: { pack: FactPack; profile: unknown; extracts: { period: string | null; payload: unknown }[]; news: { url: string; publishedOn: string | null; title: string; summary: string }[]; macro: MacroBrief | null; previous?: CompanyReport }): string {
  const { pack } = a;
  const flat = (text: string, max: number) => text.replace(/[\p{Cc}`<>{}]/gu, ' ').replace(/\s+/g, ' ').slice(0, max);
  return [
    `Company: ${pack.name} (${pack.ticker}), sector ${pack.sector}. Data as of ${pack.asOf}; last price ${pack.price} on ${pack.priceDate}.`,
    `FACT PACK (cite by key):\n${factLines(pack)}`,
    `RECENT PSX ANNOUNCEMENTS (untrusted text):\n${pack.announcements.map((x) => `${x.date} [${x.category}] ${flat(x.title, 140)}${x.url ? ` ${x.url}` : ''}`).join('\n') || 'none'}`,
    `STORED PROFILE:\n${a.profile ? JSON.stringify(a.profile) : 'none yet'}`,
    `FILING EXTRACTS:\n${a.extracts.map((e) => `${e.period ?? 'period unknown'}: ${JSON.stringify(e.payload)}`).join('\n') || 'none'}`,
    `NEWS ALREADY ON FILE:\n${a.news.map((n) => `${n.publishedOn ?? 'undated'} ${flat(n.title, 120)} - ${flat(n.summary, 300)} ${n.url}`).join('\n') || 'none'}`,
    `MACRO BRIEF:\n${a.macro ? JSON.stringify(a.macro) : 'none available'}`,
    `PREVIOUS REPORT:\n${a.previous ? JSON.stringify(a.previous) : 'none (first report)'}`,
  ].join('\n\n');
}

function compactReport(r: StoredReport): string {
  const c = r.report;
  return JSON.stringify({
    ticker: r.ticker, conviction: c.conviction, expectedReturn: c.expectedReturn, thesis: c.thesis, valuation: c.valuationView,
    dividends: c.dividendOutlook, risks: c.risks.slice(0, 4), thesisState: c.holdingView.thesisState, bear: c.bearReviewNote?.slice(0, 400),
  });
}

/** Keeps only known tickers, clamps numbers and weights, and fills the ranking the device reads. */
export function cleanRanking(raw: unknown, tickers: string[], month: string, tickersHash: string, excluded: Ranking['excluded']): Ranking {
  const body = asRecord(raw);
  const known = new Set(tickers);
  const seenTickers = new Set<string>();
  const entries: RankingEntry[] = [];
  for (const item of Array.isArray(body.entries) ? body.entries : []) {
    const e = asRecord(item);
    const ticker = typeof e.ticker === 'string' ? e.ticker.trim().toUpperCase() : '';
    if (!known.has(ticker) || seenTickers.has(ticker)) continue;
    seenTickers.add(ticker);
    entries.push({
      ticker, rank: 0,
      conviction: Math.max(0, Math.min(100, Math.round(Number(e.conviction) || 0))),
      modelWeightPct: Math.max(0, Math.min(35, Math.round((Number(e.modelWeightPct) || 0) * 10) / 10)),
      note: typeof e.note === 'string' ? e.note.slice(0, 400) : '',
    });
  }
  // Rank by the model's own order, then fix ranks to 1..n so the device never sees gaps or ties.
  const order = new Map<string, number>();
  for (const item of Array.isArray(body.entries) ? body.entries : []) {
    const e = asRecord(item);
    const key = typeof e.ticker === 'string' ? e.ticker.trim().toUpperCase() : '';
    if (key && !order.has(key)) order.set(key, Number(e.rank) || 999);
  }
  entries.sort((a, b) => (order.get(a.ticker) ?? 999) - (order.get(b.ticker) ?? 999));
  entries.forEach((e, i) => { e.rank = i + 1; });
  // Total weight cannot exceed 100: scale down proportionally.
  const total = entries.reduce((s, e) => s + e.modelWeightPct, 0);
  if (total > 100) for (const e of entries) e.modelWeightPct = Math.round((e.modelWeightPct * 1000) / total) / 10;
  for (const t of tickers) if (!seenTickers.has(t)) excluded.push({ ticker: t, reason: 'The ranking did not include this company.' });
  return { month, tickersHash, outlook: typeof body.outlook === 'string' ? body.outlook.slice(0, 1500) : '', entries, excluded };
}

export { resolveConfig };
