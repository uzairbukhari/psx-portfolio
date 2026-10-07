import {
  blankPortfolio,
  DISPLAY_PARTS,
  holdings,
  portfolioSummary,
  round,
  taxSummary,
  validate,
  type Portfolio,
} from './portfolio.ts';

export const ACCOUNT_VERSION = 1;
export const ALL_PORTFOLIOS = 'all';
export const LEGACY_PORTFOLIO_ID = 'default';
/** One login can keep at most this many portfolios. The server only holds ciphertext, so the limit is applied here. */
export const MAX_PORTFOLIOS = 4;
export type NamedPortfolio = {
  id: string;
  name: string;
  portfolio: Portfolio;
  locked?: boolean;
};
export type PortfolioAccount = {
  kind: 'sipwise-portfolio-account';
  version: 1;
  portfolios: NamedPortfolio[];
};
export type PortfolioTarget = { id: string; name?: string };

export function portfolioName(name: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 80)
    throw new Error('Enter a portfolio name between 1 and 80 characters.');
  return clean;
}

export function accountFromPortfolio(
  portfolio: Portfolio = blankPortfolio(),
): PortfolioAccount {
  return {
    kind: 'sipwise-portfolio-account',
    version: ACCOUNT_VERSION,
    portfolios: [{ id: LEGACY_PORTFOLIO_ID, name: 'My Portfolio', portfolio }],
  };
}

/**
 * Opening and re-saving what is already stored uses the old shape check only: a ledger that predates today's
 * stricter `validate` must still open. Strict validation runs for incoming edits (savePortfolioView) and backups.
 */
function checkLedger(portfolio: Portfolio, strict: boolean) {
  if (strict) return validate(portfolio);
  if (
    !portfolio ||
    !Array.isArray(portfolio.companies) ||
    !Array.isArray(portfolio.trades)
  )
    throw new Error('The decrypted portfolio is not readable.');
}

/** Old ledgers are wrapped without changing a single financial record. No migration writes on unlock. */
export function normalizeAccount(
  value: unknown,
  strict = true,
): PortfolioAccount {
  if (!value || typeof value !== 'object')
    throw new Error('The decrypted portfolio is not readable.');
  if ('kind' in value && value.kind === 'sipwise-portfolio-account') {
    const account = value as PortfolioAccount;
    if (account.version !== ACCOUNT_VERSION)
      throw new Error('Update the app to open this portfolio collection.');
    if (!Array.isArray(account.portfolios) || !account.portfolios.length)
      throw new Error('The portfolio collection is empty or damaged.');
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const entry of account.portfolios) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id) ||
        entry.id === ALL_PORTFOLIOS ||
        ids.has(entry.id)
      )
        throw new Error(
          'The portfolio collection contains an invalid identifier.',
        );
      if (
        typeof entry.name !== 'string' ||
        portfolioName(entry.name) !== entry.name ||
        names.has(entry.name.toLowerCase())
      )
        throw new Error('Portfolio names must be unique.');
      ids.add(entry.id);
      names.add(entry.name.toLowerCase());
      if (entry.locked !== undefined && typeof entry.locked !== 'boolean')
        throw Error('Invalid portfolio lock.');
      checkLedger(entry.portfolio, strict);
    }
    return account;
  }
  checkLedger(value as Portfolio, strict);
  return accountFromPortfolio(value as Portfolio);
}

export function portfolioAt(
  account: PortfolioAccount,
  target?: PortfolioTarget,
): Portfolio {
  const entry = target
    ? account.portfolios.find((p) => p.id === target.id)
    : account.portfolios[0];
  if (entry) return entry.portfolio;
  if (target?.name) return blankPortfolio(); // an import's unsaved destination
  throw new Error(
    'That portfolio no longer exists. Reload and choose another portfolio.',
  );
}

export function replacePortfolio(
  account: PortfolioAccount,
  portfolio: Portfolio,
  target?: PortfolioTarget,
): PortfolioAccount {
  const id = target?.id ?? account.portfolios[0].id;
  assertPortfolioWritable(account, id);
  const exists = account.portfolios.some((p) => p.id === id);
  if (!exists && !target?.name)
    throw new Error('That portfolio no longer exists.');
  const next: PortfolioAccount = {
    ...account,
    portfolios: exists
      ? account.portfolios.map((p) => (p.id === id ? { ...p, portfolio } : p))
      : [
          ...account.portfolios,
          { id, name: portfolioName(target!.name!), portfolio },
        ],
  };
  return normalizeAccount(next, false);
}

export function hasFinancialRecords(portfolio: Portfolio): boolean {
  return !!(
    portfolio.trades.length ||
    portfolio.dividends?.length ||
    portfolio.stockSplits?.length ||
    portfolio.assets?.length
  );
}

export function assertCanAddPortfolio(account: PortfolioAccount) {
  if (account.portfolios.length >= MAX_PORTFOLIOS)
    throw new Error(
      `You can keep up to ${MAX_PORTFOLIOS} portfolios. Delete one to create another.`,
    );
}

export function renamePortfolio(
  account: PortfolioAccount,
  id: string,
  name: string,
): PortfolioAccount {
  if (!account.portfolios.some((p) => p.id === id))
    throw new Error('That portfolio no longer exists.');
  return normalizeAccount(
    {
      ...account,
      portfolios: account.portfolios.map((p) =>
        p.id === id ? { ...p, name: portfolioName(name) } : p,
      ),
    },
    false,
  );
}

export function removePortfolio(
  account: PortfolioAccount,
  id: string,
): PortfolioAccount {
  const entry = account.portfolios.find((p) => p.id === id);
  if (!entry) throw new Error('That portfolio no longer exists.');
  assertPortfolioWritable(account, id);
  if (account.portfolios.length === 1)
    throw new Error('Keep at least one portfolio.');
  return {
    ...account,
    portfolios: account.portfolios.filter((p) => p.id !== id),
  };
}

const sumKnown = (values: (number | null)[]) =>
  values.some((n) => n === null)
    ? null
    : round(values.reduce<number>((a, n) => a + n!, 0));

/** Calculate each ledger FIRST. Aggregating raw trades would corrupt average costs and sale availability. */
export function consolidatedAccount(account: PortfolioAccount) {
  const breakdown = account.portfolios.map((entry) => {
    const positions = holdings(entry.portfolio);
    return {
      ...entry,
      positions,
      summary: portfolioSummary(positions),
      tax: taxSummary(entry.portfolio),
    };
  });
  const groups = new Map<
    string,
    {
      ticker: string;
      name: string;
      shares: number;
      cost: number | null;
      value: number | null;
      gain: number | null;
      portfolios: {
        id: string;
        name: string;
        shares: number;
        cost: number | null;
        value: number | null;
      }[];
    }
  >();
  for (const entry of breakdown)
    for (const h of entry.positions.filter((h) => h.shares > 0)) {
      const row = groups.get(h.ticker) ?? {
        ticker: h.ticker,
        name: h.name,
        shares: 0,
        cost: 0,
        value: 0,
        gain: 0,
        portfolios: [],
      };
      row.shares += h.shares;
      row.cost = sumKnown([row.cost, h.cost]);
      row.value = sumKnown([row.value, h.value]);
      row.gain = sumKnown([row.gain, h.gain]);
      row.portfolios.push({
        id: entry.id,
        name: entry.name,
        shares: h.shares,
        cost: h.cost,
        value: h.value,
      });
      groups.set(h.ticker, row);
    }
  const summary = portfolioSummary(breakdown.flatMap((e) => e.positions));
  const tax = {
    receivedDividends: round(
      breakdown.reduce((n, e) => n + e.tax.totalDividendIncomeGross, 0),
    ),
    realizedGain: round(
      breakdown.reduce((n, e) => n + e.tax.totalRealizedGain, 0),
    ),
    capitalGainsTax: sumKnown(breakdown.map((e) => e.tax.totalCapitalGainsTax)),
    dividendTax: sumKnown(breakdown.map((e) => e.tax.totalDividendTax)),
    netRealizedReturn: sumKnown(breakdown.map((e) => e.tax.netRealizedReturn)),
    unknownSaleCosts: breakdown.reduce(
      (n, e) => n + e.tax.sales.filter((s) => s.costBasis === null).length,
      0,
    ),
    expectedDividends: breakdown.reduce(
      (n, e) => n + e.tax.expectedDividends.count,
      0,
    ),
  };
  const positions = [...groups.values()].sort(
    (a, b) =>
      (b.value ?? -1) - (a.value ?? -1) || a.ticker.localeCompare(b.ticker),
  );
  return {
    breakdown,
    positions,
    summary: {
      ...summary,
      heldCount: positions.length,
      missingPrice: [...new Set(summary.missingPrice)],
      unknownCost: [...new Set(summary.unknownCost)],
    },
    tax,
  };
}

/** Durable identities only. Identical-looking manual fills are never treated as cross-portfolio duplicates. */
export function importMatches(
  account: PortfolioAccount,
  destination: string,
  next: Portfolio,
  fileHash?: string,
): NamedPortfolio[] {
  const identities = new Set([
    ...next.trades
      .filter((t) => t.externalId)
      .map((t) => `${t.source ?? ''}:${t.externalId}`),
    ...(next.dividends ?? [])
      .filter((d) => d.externalId)
      .map((d) => `${d.source}:${d.externalId}`),
  ]);
  const before = account.portfolios.find(
    (p) => p.id === destination,
  )?.portfolio;
  for (const t of before?.trades ?? [])
    if (t.externalId) identities.delete(`${t.source ?? ''}:${t.externalId}`);
  for (const d of before?.dividends ?? [])
    if (d.externalId) identities.delete(`${d.source}:${d.externalId}`);
  return account.portfolios.filter(
    (entry) =>
      entry.id !== destination &&
      ((fileHash && entry.portfolio.brokerFileHashes?.includes(fileHash)) ||
        entry.portfolio.trades.some(
          (t) =>
            t.externalId && identities.has(`${t.source ?? ''}:${t.externalId}`),
        ) ||
        entry.portfolio.dividends?.some(
          (d) => d.externalId && identities.has(`${d.source}:${d.externalId}`),
        )),
  );
}

export function accountActivity(account: PortfolioAccount) {
  return account.portfolios
    .flatMap((p) => [
      ...p.portfolio.trades.map((t) => ({
        id: t.id,
        date: t.date,
        ticker: t.ticker,
        kind: t.kind,
        note: t.note,
        voided: !!t.voided,
        amount: t.price === null ? null : round(t.shares * t.price),
        portfolioId: p.id,
        portfolioName: p.name,
      })),
      ...(p.portfolio.dividends ?? []).map((d) => ({
        id: d.id,
        date: d.paymentDate ?? d.date,
        ticker: d.ticker,
        kind:
          d.source === 'auto' && d.status !== 'received'
            ? 'Expected dividend'
            : 'Dividend',
        note: d.note,
        voided: !!d.voided,
        amount: d.grossAmount ?? null,
        portfolioId: p.id,
        portfolioName: p.name,
      })),
      ...(p.portfolio.stockSplits ?? []).map((s) => ({
        id: s.id,
        date: s.date,
        ticker: s.ticker,
        kind: 'Split',
        note: s.note,
        voided: !!s.voided,
        amount: null,
        portfolioId: p.id,
        portfolioName: p.name,
      })),
    ])
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        a.portfolioId.localeCompare(b.portfolioId) ||
        a.id.localeCompare(b.id),
    );
}

export function assertPortfolioWritable(account: PortfolioAccount, id: string) {
  if (account.portfolios.find((p) => p.id === id)?.locked)
    throw Error(
      'This portfolio is locked. Unlock it in Settings → Portfolios before making changes.',
    );
}
export function setPortfolioLocked(
  account: PortfolioAccount,
  id: string,
  locked: boolean,
): PortfolioAccount {
  if (!account.portfolios.some((p) => p.id === id))
    throw Error('That portfolio no longer exists.');
  return {
    ...account,
    portfolios: account.portfolios.map((p) =>
      p.id === id ? { ...p, locked } : p,
    ),
  };
}
export function assertAccountWritable(
  previous: PortfolioAccount,
  next: PortfolioAccount,
) {
  for (const entry of previous.portfolios.filter((p) => p.locked)) {
    const replacement = next.portfolios.find((p) => p.id === entry.id);
    if (
      !replacement ||
      JSON.stringify(replacement.portfolio) !== JSON.stringify(entry.portfolio)
    )
      assertPortfolioWritable(previous, entry.id);
  }
}
/** Read-only presentation data. Accounting delegates to the original parts through DISPLAY_PARTS. */
export function dashboardPortfolio(
  account: PortfolioAccount,
  selected = ALL_PORTFOLIOS,
): Portfolio {
  if (account.portfolios.length === 1) return account.portfolios[0].portfolio;
  if (selected !== ALL_PORTFOLIOS)
    return portfolioAt(account, { id: selected });
  const result = blankPortfolio();
  result[DISPLAY_PARTS] = account.portfolios;
  result.dividends = [];
  const companies = new Map<string, Portfolio['companies'][number]>();
  for (const part of account.portfolios) {
    for (const company of part.portfolio.companies)
      if (!companies.has(company.ticker))
        companies.set(company.ticker, { ...company, target: 0 });
    for (const [ticker, quote] of Object.entries(part.portfolio.quotes))
      if (!result.quotes[ticker] || quote.date > result.quotes[ticker].date)
        result.quotes[ticker] = quote;
    result.trades.push(
      ...part.portfolio.trades.map((t) => ({
        ...t,
        id: `${part.id}::${t.id}`,
        note: `${part.name}${t.note ? ' · ' + t.note : ''}`,
      })),
    );
    result.dividends!.push(
      ...(part.portfolio.dividends ?? []).map((d) => ({
        ...d,
        id: `${part.id}::${d.id}`,
        note: `${part.name}${d.note ? ' · ' + d.note : ''}`,
      })),
    );
    result.stockSplits ??= [];
    result.stockSplits.push(
      ...(part.portfolio.stockSplits ?? []).map((d) => ({
        ...d,
        id: `${part.id}::${d.id}`,
        note: `${part.name}${d.note ? ' · ' + d.note : ''}`,
      })),
    );
    result.notifications ??= [];
    result.notifications.push(
      ...(part.portfolio.notifications ?? []).map((n) => ({
        ...n,
        id: `${part.id}::${n.id}`,
        title: `${part.name} · ${n.title}`,
      })),
    );
    for (const [month, budget] of Object.entries(part.portfolio.budgets))
      result.budgets[month] = (result.budgets[month] ?? 0) + budget;
  }
  result.companies = [...companies.values()];
  // Monthly Picks keeps its shortlist in the account's first portfolio; the All view follows it.
  const shortlist = account.portfolios[0]?.portfolio.monthlyPicksShortlist;
  if (shortlist?.length) result.monthlyPicksShortlist = [...shortlist];
  return result;
}
