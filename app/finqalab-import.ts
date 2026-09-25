import { type Company, type Portfolio, type Trade } from '@/lib/portfolio';

export type FinqalabTrade = {
  ticker: string;
  tradeNo: string;
  date: string;
  kind: 'buy' | 'sell';
  price: number;
  shares: number;
  fees: number;
};

export type FinqalabImportSummary = {
  companies: Company[];
  trades: Trade[];
  imported: number;
  skippedDuplicate: number;
  skippedManualMatch: number;
  addedCompanies: number;
};

const rowPattern = /\b([A-Z0-9]{2,12})\s+(\d+)\s+(?:\d+\s+)?(\d{4}-\d{2}-\d{2})\s+\d{4}-\d{2}-\d{2}\s+(BUY|SELL)\s+(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g;

function number(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw Error(`Invalid ${label} in Finqalab report.`);
  return parsed;
}

/** Parses only Finqalab's current Periodic Trade Details Report line items. */
export function parseFinqalabReport(text: string): FinqalabTrade[] {
  if (!/Periodic\s+Trade\s+Details\s+Report\s+By\s+Finqalab/i.test(text))
    throw Error('Choose a Finqalab Periodic Trade Details Report PDF.');
  const total = /Total\s+Records:\s*(\d+)/i.exec(text);
  if (!total) throw Error('Finqalab report is missing its Total Records count.');
  const rows: FinqalabTrade[] = [];
  const tradeNos = new Set<string>();
  for (const match of text.matchAll(rowPattern)) {
    const [, ticker, tradeNo, date, side, rawPrice, rawShares, , , rawFees] = match;
    if (tradeNos.has(tradeNo)) throw Error('Finqalab report contains a repeated Trade No.');
    const price = number(rawPrice, 'rate');
    const shares = number(rawShares, 'quantity');
    const fees = number(rawFees, 'broker charge');
    if (!Number.isSafeInteger(shares) || shares <= 0 || price <= 0)
      throw Error('Finqalab report contains an invalid trade line.');
    tradeNos.add(tradeNo);
    rows.push({
      ticker,
      tradeNo,
      date,
      kind: side === 'BUY' ? 'buy' : 'sell',
      price,
      shares,
      fees,
    });
  }
  if (rows.length !== Number(total[1]))
    throw Error(`Finqalab report says it has ${total[1]} trades, but ${rows.length} readable trade lines were found.`);
  return rows;
}

function sameManualTrade(existing: Trade, incoming: FinqalabTrade) {
  return (
    !existing.voided &&
    existing.source !== 'finqalab' &&
    existing.ticker === incoming.ticker &&
    existing.kind === incoming.kind &&
    existing.date === incoming.date &&
    existing.shares === incoming.shares &&
    existing.price === incoming.price &&
    existing.fees === incoming.fees
  );
}

export function importFinqalabTrades(
  portfolio: Portfolio,
  incoming: FinqalabTrade[],
): FinqalabImportSummary {
  const companies = [...portfolio.companies];
  const trades: Trade[] = [];
  const tickers = new Set(companies.map((company) => company.ticker));
  const importedIds = new Set(
    portfolio.trades
      .filter((trade) => !trade.voided && trade.source === 'finqalab')
      .map((trade) => trade.externalId),
  );
  let skippedDuplicate = 0;
  let skippedManualMatch = 0;
  let addedCompanies = 0;
  for (const entry of incoming) {
    const externalId = `finqalab:${entry.tradeNo}`;
    if (importedIds.has(externalId)) {
      skippedDuplicate++;
      continue;
    }
    if (portfolio.trades.some((trade) => sameManualTrade(trade, entry))) {
      skippedManualMatch++;
      continue;
    }
    if (!tickers.has(entry.ticker)) {
      companies.push({
        ticker: entry.ticker,
        name: entry.ticker,
        sector: '',
        target: 0,
        approved: false,
        screenDate: '',
        note: 'Added from a Finqalab trade import. Review company details before any new SIP allocation.',
      });
      tickers.add(entry.ticker);
      addedCompanies++;
    }
    trades.push({
      id: crypto.randomUUID(),
      ticker: entry.ticker,
      kind: entry.kind,
      date: entry.date,
      shares: entry.shares,
      price: entry.price,
      fees: entry.fees,
      month: entry.kind === 'buy' ? entry.date.slice(0, 7) : '',
      note: `Imported from Finqalab Trade No. ${entry.tradeNo}.`,
      source: 'finqalab',
      externalId,
    });
    importedIds.add(externalId);
  }
  return {
    companies,
    trades,
    imported: trades.length,
    skippedDuplicate,
    skippedManualMatch,
    addedCompanies,
  };
}
