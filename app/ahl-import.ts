import { type Company, type Portfolio, type Trade } from '../lib/portfolio.ts';

export type AhlTrade = {
  ticker: string;
  date: string;
  kind: 'buy' | 'sell';
  price: number;
  shares: number;
  fees: number;
  externalId: string;
};

export type AhlImportSummary = {
  companies: Company[];
  trades: Trade[];
  imported: number;
  skippedDuplicate: number;
  skippedManualMatch: number;
  addedCompanies: number;
  voidedTradeIds: string[];
};

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})$/.exec(value);
  if (!match || !MONTHS[match[1]]) return null;
  const iso = `${match[3]}-${MONTHS[match[1]]}-${match[2]}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

function fingerprint(row: AhlTrade, occurrence: number) {
  return `ahl:${row.ticker}|${row.kind}|${row.date}|${row.shares}|${row.price}|${row.fees}|${occurrence}`;
}

export function parseAhlHistory(raw: unknown): AhlTrade[] {
  if (!Array.isArray(raw) || !raw.length)
    throw Error('Choose a non-empty AHL trade history JSON file.');
  const occurrences = new Map<string, number>();
  return raw.map((value, index) => {
    const row = value as Record<string, unknown>;
    const ticker = typeof row.scrip === 'string' ? row.scrip.toUpperCase() : '';
    const shares = Number(row.quantity);
    const price = Number(row.grossRate);
    const netAmount = Number(row.netAmount);
    const date = parseDate(row.executionDate);
    const kind = row.type === 'Buy' ? 'buy' : row.type === 'Sell' ? 'sell' : null;
    if (
      !/^[A-Z0-9]{2,12}$/.test(ticker) ||
      !Number.isSafeInteger(shares) || shares <= 0 ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(netAmount) || !date || !kind
    ) throw Error(`AHL row ${index + 1} contains invalid trade details.`);
    const gross = shares * price;
    const rawFees = kind === 'buy' ? Math.abs(netAmount) - gross : gross - Math.abs(netAmount);
    const fees = Math.round((rawFees + Number.EPSILON) * 10_000) / 10_000;
    if (!Number.isFinite(fees) || fees < 0)
      throw Error(`AHL row ${index + 1} has an invalid net amount.`);
    const parsed = { ticker, date, kind, price, shares, fees } as AhlTrade;
    const base = `${ticker}|${kind}|${date}|${shares}|${price}|${fees}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    parsed.externalId = fingerprint(parsed, occurrence);
    return parsed;
  });
}

function sameManualTrade(existing: Trade, incoming: AhlTrade) {
  return (
    !existing.voided &&
    existing.source !== 'ahl' && existing.source !== 'finqalab' &&
    existing.ticker === incoming.ticker && existing.kind === incoming.kind &&
    existing.date === incoming.date && existing.shares === incoming.shares &&
    existing.price === incoming.price && existing.fees === incoming.fees
  );
}

function ahlSharesOn(
  portfolio: Portfolio,
  ticker: string,
  rows: AhlTrade[],
  throughDate: string,
) {
  let shares = 0;
  const dates = new Set([
    ...rows.filter((row) => row.date <= throughDate).map((row) => row.date),
    ...(portfolio.stockSplits ?? [])
      .filter(
        (split) =>
          !split.voided && split.ticker === ticker && split.date <= throughDate,
      )
      .map((split) => split.date),
  ]);
  for (const date of [...dates].sort()) {
    const split = (portfolio.stockSplits ?? []).find(
      (entry) =>
        !entry.voided && entry.ticker === ticker && entry.date === date,
    );
    if (split) shares = (shares * split.newShares) / split.oldShares;
    for (const row of rows.filter((entry) => entry.date === date))
      shares += row.kind === 'buy' ? row.shares : -row.shares;
  }
  return shares;
}

export function importAhlTrades(
  portfolio: Portfolio,
  incoming: AhlTrade[],
): AhlImportSummary {
  const companies = [...portfolio.companies];
  const trades: Trade[] = [];
  const tickers = new Set(companies.map((company) => company.ticker));
  const importedIds = new Set(
    portfolio.trades
      .filter((trade) => !trade.voided && trade.source === 'ahl')
      .map((trade) => trade.externalId),
  );
  const voidedTradeIds = new Set<string>();
  let skippedDuplicate = 0, skippedManualMatch = 0, addedCompanies = 0;
  for (const entry of incoming) {
    if (importedIds.has(entry.externalId)) {
      skippedDuplicate++;
      continue;
    }
    if (portfolio.trades.some((trade) => sameManualTrade(trade, entry))) {
      skippedManualMatch++;
      continue;
    }
    if (!tickers.has(entry.ticker)) {
      companies.push({
        ticker: entry.ticker, name: entry.ticker, sector: '', target: 0,
        approved: false, screenDate: '',
        note: 'Added from an AHL trade import. Review company details before any new SIP allocation.',
      });
      tickers.add(entry.ticker);
      addedCompanies++;
    }
    trades.push({
      id: crypto.randomUUID(), ticker: entry.ticker, kind: entry.kind,
      date: entry.date, shares: entry.shares, price: entry.price, fees: entry.fees,
      month: entry.kind === 'buy' ? entry.date.slice(0, 7) : '',
      note: 'Imported from AHL trade history.', source: 'ahl',
      externalId: entry.externalId,
    });
    importedIds.add(entry.externalId);
  }

  // Replace an older AHL snapshot only when this history independently
  // reproduces its exact quantity on the snapshot date.
  const historyByTicker = new Map<string, AhlTrade[]>();
  for (const entry of incoming) {
    const rows = historyByTicker.get(entry.ticker) ?? [];
    rows.push(entry);
    historyByTicker.set(entry.ticker, rows);
  }
  for (const opening of portfolio.trades.filter(
    (trade) => !trade.voided && trade.kind === 'opening' && trade.source !== 'finqalab',
  )) {
    const rows = historyByTicker.get(opening.ticker);
    if (!rows) continue;
    const sharesOnDate = ahlSharesOn(
      portfolio,
      opening.ticker,
      rows,
      opening.date,
    );
    if (sharesOnDate === opening.shares) voidedTradeIds.add(opening.id);
  }

  // Some exports begin after securities were acquired. Preserve such sales by
  // recording only the minimum unknown-cost opening quantity needed.
  const existingAhl = portfolio.trades.filter(
    (trade) =>
      !trade.voided &&
      trade.source === 'ahl' &&
      !trade.externalId?.startsWith('ahl:opening:'),
  );
  const allAhl = [...existingAhl, ...trades].filter(
    (trade) => trade.kind === 'buy' || trade.kind === 'sell',
  );
  const deltas = new Map<string, Map<string, number>>();
  for (const trade of allAhl) {
    const dates = deltas.get(trade.ticker) ?? new Map<string, number>();
    dates.set(
      trade.date,
      (dates.get(trade.date) ?? 0) +
        (trade.kind === 'buy' ? trade.shares : -trade.shares),
    );
    deltas.set(trade.ticker, dates);
  }
  const desiredAdjustments = new Map<string, { ticker: string; date: string; shares: number }>();
  for (const [ticker, dates] of deltas) {
    let balance = 0;
    const eventDates = new Set([
      ...dates.keys(),
      ...(portfolio.stockSplits ?? [])
        .filter((split) => !split.voided && split.ticker === ticker)
        .map((split) => split.date),
    ]);
    for (const date of [...eventDates].sort()) {
      const split = (portfolio.stockSplits ?? []).find(
        (entry) =>
          !entry.voided && entry.ticker === ticker && entry.date === date,
      );
      if (split) balance = (balance * split.newShares) / split.oldShares;
      const delta = dates.get(date) ?? 0;
      balance += delta;
      if (balance >= 0) continue;
      const shares = -balance;
      const externalId = `ahl:opening:${ticker}:${date}:${shares}`;
      desiredAdjustments.set(externalId, { ticker, date, shares });
      balance = 0;
    }
  }
  for (const adjustment of portfolio.trades.filter(
    (trade) =>
      !trade.voided &&
      trade.source === 'ahl' &&
      trade.externalId?.startsWith('ahl:opening:'),
  )) {
    if (!desiredAdjustments.has(adjustment.externalId!))
      voidedTradeIds.add(adjustment.id);
  }
  for (const [externalId, adjustment] of desiredAdjustments) {
    if (importedIds.has(externalId)) continue;
    trades.unshift({
      id: crypto.randomUUID(), ticker: adjustment.ticker, kind: 'opening',
      date: adjustment.date, shares: adjustment.shares, price: null, fees: 0,
      month: '', note: 'AHL history starts after these shares were acquired; original cost is unknown.',
      source: 'ahl', externalId,
    });
    importedIds.add(externalId);
  }
  return {
    companies, trades, imported: trades.filter((trade) => trade.kind !== 'opening').length,
    skippedDuplicate, skippedManualMatch, addedCompanies,
    voidedTradeIds: [...voidedTradeIds],
  };
}
