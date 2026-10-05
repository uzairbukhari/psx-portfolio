import { dateOK, sharesHeldOn, validate, type Portfolio } from './portfolio.ts';

export type BrokerTrade = { ticker: string; date: string; side: 'buy' | 'sell'; shares: number; price: number; fees: number; reference: string | null; line: number };
export type BrokerHolding = { ticker: string; asOf: string; shares: number; line: number };
export type BrokerStatement = { broker: string; account: string; report: 'trades' | 'holdings' | 'both'; trades: BrokerTrade[]; holdings: BrokerHolding[]; warnings: string[] };
/** A reviewed header mapping for a tabular export, held inside the encrypted portfolio. */
export type BrokerFormat = { broker: string; signature: string; report: 'trades' | 'holdings'; dateStyle: 'iso' | 'dmy'; columns: Record<'ticker' | 'date' | 'side' | 'shares' | 'price' | 'fees' | 'reference', number | null> };
export type BrokerImportRow = { key: string; trade: BrokerTrade; status: 'new' | 'duplicate' | 'ambiguous' | 'removed'; action: 'import' | 'skip' };
export type BrokerAdjustment = { key: string; ticker: string; asOf: string; before: number; reported: number; difference: number; action: 'import' | 'skip' };
export type BrokerImportPlan = { rows: BrokerImportRow[]; adjustments: BrokerAdjustment[]; blockers: string[]; newCompanies: string[]; accountId: string; assignIds: string[] };

const tickerOK = (x: string) => /^[A-Z0-9]{2,12}$/.test(x);
const safe = (x: string) => x.trim().toUpperCase();
const finite = (n: number) => Number.isFinite(n);
export function validateBrokerStatement(raw: unknown): BrokerStatement {
  if (!raw || typeof raw !== 'object') throw Error('The statement could not be read.');
  const s = raw as BrokerStatement;
  if (typeof s.broker !== 'string' || !s.broker.trim() || s.broker.length > 80 || typeof s.account !== 'string' || s.account.length > 80 ||
      !['trades', 'holdings', 'both'].includes(s.report) || !Array.isArray(s.trades) || !Array.isArray(s.holdings) ||
      s.trades.length + s.holdings.length > 20000) throw Error('The statement result is incomplete.');
  const trades = s.trades.map((t, i) => {
    if (!t || !tickerOK(safe(t.ticker)) || !dateOK(t.date) || !['buy', 'sell'].includes(t.side) ||
        !Number.isSafeInteger(t.shares) || t.shares <= 0 || !finite(t.price) || t.price <= 0 ||
        !finite(t.fees) || t.fees < 0 || (t.reference !== null && typeof t.reference !== 'string'))
      throw Error(`Trade row ${i + 1} needs correction in the source file.`);
    return { ...t, ticker: safe(t.ticker), reference: t.reference?.slice(0, 80) ?? null, line: Number.isSafeInteger(t.line) ? t.line : i + 1 };
  });
  const holdings = s.holdings.map((h, i) => {
    if (!h || !tickerOK(safe(h.ticker)) || !dateOK(h.asOf) || !Number.isSafeInteger(h.shares) || h.shares < 0)
      throw Error(`Holding row ${i + 1} needs correction in the source file.`);
    return { ...h, ticker: safe(h.ticker), line: Number.isSafeInteger(h.line) ? h.line : i + 1 };
  });
  const balanceKeys = holdings.map((h) => `${h.ticker}:${h.asOf}`);
  if (new Set(balanceKeys).size !== balanceKeys.length) throw Error('The statement has conflicting repeated holding snapshots.');
  if (!trades.length && !holdings.length) throw Error('No trades or holdings were found.');
  return { broker: s.broker.trim(), account: s.account.trim(), report: s.report, trades, holdings, warnings: Array.isArray(s.warnings) ? s.warnings.filter((w) => typeof w === 'string').slice(0, 20) : [] };
}

function fingerprint(t: BrokerTrade) {
  return [t.ticker, t.date, t.side, t.shares, t.price, t.fees].join('|');
}
function keyHash(value: string) {
  let hash = BigInt('0xcbf29ce484222325');
  for (const byte of new TextEncoder().encode(value)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * BigInt('0x100000001b3'));
  return hash.toString(16).padStart(16, '0');
}
function accountOf(s: BrokerStatement) { return `${safe(s.broker)}:${safe(s.account || 'DEFAULT')}`.slice(0, 80); }
export function planBrokerImport(p: Portfolio, s: BrokerStatement, actions: Record<string, 'import' | 'skip'> = {}, assignIds: string[] = []): BrokerImportPlan {
  const accountId = accountOf(s);
  const active = p.trades.filter((t) => !t.voided);
  const seen = new Set<string>();
  const consumed = new Set<string>();
  const rows: BrokerImportRow[] = [];
  const blockers: string[] = [];
  s.trades.forEach((trade, index) => {
    const base = trade.reference ? `${accountId}:${trade.reference}` : `${accountId}:${fingerprint(trade)}`;
    const ordinal = [...seen].filter((x) => x.startsWith(`${base}#`)).length + 1;
    const key = `broker:${keyHash(base)}:${ordinal}`;
    seen.add(`${base}#${ordinal}`);
    const previous = p.trades.find((t) => !t.voided && t.source === 'broker' && t.externalId === key) ?? p.trades.find((t) => t.source === 'broker' && t.externalId === key);
    const exact = active.find((t) => !consumed.has(t.id) && t.ticker === trade.ticker && t.date === trade.date && t.kind === trade.side && t.shares === trade.shares && t.price === trade.price && t.fees === trade.fees && (!t.accountId || t.accountId === accountId));
    if (exact) consumed.add(exact.id);
    const similar = active.some((t) => t.ticker === trade.ticker && t.date === trade.date && t.kind === trade.side && t.shares === trade.shares && !consumed.has(t.id));
    const samePrevious = previous && previous.ticker === trade.ticker && previous.date === trade.date && previous.kind === trade.side && previous.shares === trade.shares && previous.price === trade.price && previous.fees === trade.fees;
    const status = previous?.voided ? 'removed' : previous && !samePrevious ? 'ambiguous' : previous || exact ? 'duplicate' : similar ? 'ambiguous' : 'new';
    const action = status === 'duplicate' ? 'skip' : actions[key] ?? (status === 'new' ? 'import' : 'skip');
    if (status === 'ambiguous' && !actions[key]) blockers.push(`Trade row ${index + 1} looks like an existing trade; choose Import or Skip.`);
    if (previous && !previous.voided && !samePrevious && action === 'import') blockers.push(`Trade row ${index + 1} reuses a transaction reference with changed details. Correct or void the earlier entry first.`);
    rows.push({ key, trade, status, action });
  });
  const legacy = p.trades.filter((t) => !t.voided && !t.accountId && !assignIds.includes(t.id) && s.holdings.some((h) => h.ticker === t.ticker));
  if (s.holdings.length && legacy.length) blockers.push('Existing holdings without a broker account overlap this statement. Assign those entries to an account before applying balance adjustments.');
  const draft: Portfolio = { ...p, companies: [...p.companies], trades: [...p.trades] };
  draft.trades = draft.trades.map((t) => assignIds.includes(t.id) ? { ...t, accountId } : t);
  const known = new Set(draft.companies.map((c) => c.ticker));
  const newCompanies = [...new Set([...rows.filter((r) => r.action === 'import').map((r) => r.trade.ticker), ...s.holdings.map((h) => h.ticker)])].filter((t) => !known.has(t));
  for (const ticker of newCompanies) draft.companies.push({ ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '', note: `Imported from ${s.broker}; review before allocating.` });
  for (const r of rows.filter((r) => r.action === 'import')) draft.trades.push({ id: `preview-${r.key}`, ticker: r.trade.ticker, kind: r.trade.side, date: r.trade.date, shares: r.trade.shares, price: r.trade.price, fees: r.trade.fees, month: r.trade.side === 'buy' ? r.trade.date.slice(0,7) : '', note: `Imported from ${s.broker} statement.`, source: 'broker', accountId, externalId: r.key });
  const adjustments: BrokerAdjustment[] = [];
  for (const h of [...s.holdings].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.ticker.localeCompare(b.ticker))) {
    const accountView = { ...draft, trades: draft.trades.filter((t) => t.accountId === accountId) };
    const before = sharesHeldOn(accountView, h.ticker, h.asOf);
    const difference = h.shares - before;
    const key = `broker:balance:${keyHash(`${accountId}:${h.ticker}:${h.asOf}`)}`;
    if (difference) {
      const action = actions[key] ?? 'skip';
      adjustments.push({ key, ticker: h.ticker, asOf: h.asOf, before, reported: h.shares, difference, action });
      if (!actions[key]) blockers.push(`${h.ticker} balance differs by ${difference} shares; choose Import or Skip.`);
      if (action === 'import') draft.trades.push({ id: `preview-${key}`, ticker: h.ticker, kind: 'adjustment', date: h.asOf, shares: difference, price: null, fees: 0, month: '', note: `Balance adjustment from ${s.broker} statement; acquisition cost unknown.`, source: 'broker', accountId, externalId: key });
    }
  }
  if (!blockers.length) try { validate(draft); } catch (e) { blockers.push(e instanceof Error ? e.message : String(e)); }
  return { rows, adjustments, blockers, newCompanies, accountId, assignIds };
}
export function applyBrokerImport(p: Portfolio, s: BrokerStatement, plan: BrokerImportPlan): Portfolio {
  if (plan.blockers.length) throw Error(plan.blockers[0]);
  const next = structuredClone(p);
  for (const t of next.trades) if (plan.assignIds.includes(t.id)) t.accountId = plan.accountId;
  for (const ticker of plan.newCompanies) next.companies.push({ ticker, name: ticker, sector: '', target: 0, approved: false, screenDate: '', note: `Imported from ${s.broker}; review before allocating.` });
  for (const r of plan.rows.filter((r) => r.action === 'import')) next.trades.push({ id: crypto.randomUUID(), ticker: r.trade.ticker, kind: r.trade.side, date: r.trade.date, shares: r.trade.shares, price: r.trade.price, fees: r.trade.fees, month: r.trade.side === 'buy' ? r.trade.date.slice(0,7) : '', note: `Imported from ${s.broker} statement.`, source: 'broker', accountId: plan.accountId, externalId: r.key });
  for (const a of plan.adjustments.filter((a) => a.action === 'import')) next.trades.push({ id: crypto.randomUUID(), ticker: a.ticker, kind: 'adjustment', date: a.asOf, shares: a.difference, price: null, fees: 0, month: '', note: `Balance adjustment from ${s.broker} statement; acquisition cost unknown.`, source: 'broker', accountId: plan.accountId, externalId: a.key });
  validate(next);
  return next;
}
