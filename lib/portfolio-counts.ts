// The user-facing counts, defined once so web and mobile cannot disagree:
//  - savedCompanies: unique companies the user has saved;
//  - holdings: unique securities with positive ledger-derived shares;
//  - shortlisted: valid selected symbols (saved, unique);
//  - assessed: shortlisted companies that met the evidence policy in a run.
// Market coverage (securities in the All-Share source table) is a different thing and lives in market breadth.
import { holdings, type Portfolio } from './portfolio.ts';

export type PortfolioCounts = { savedCompanies: number; holdings: number; shortlisted: number; assessed: number | null };

export function portfolioCounts(portfolio: Portfolio, shortlist: string[], assessedTickers?: string[]): PortfolioCounts {
  const saved = new Set(portfolio.companies.map((company) => company.ticker));
  const held = new Set(holdings(portfolio).filter((h) => h.shares > 0).map((h) => h.ticker));
  const selected = new Set(shortlist.filter((ticker) => saved.has(ticker)));
  const assessed = assessedTickers ? new Set(assessedTickers.filter((ticker) => selected.has(ticker))) : null;
  return { savedCompanies: saved.size, holdings: held.size, shortlisted: selected.size, assessed: assessed ? assessed.size : null };
}
