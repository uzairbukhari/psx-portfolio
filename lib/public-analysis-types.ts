// Shape of GET /api/recommendations?tickers=. Types only, so the mobile bundle can import it.
import type { CompanyScore } from './company-facts.ts';
import type { FactsState } from './monthly-picks-flow.ts';
import type { SnapshotCompany } from './monthly-picks-ai.ts';

export type PublicAnalysis = {
  dataAsOf: string;
  companies: SnapshotCompany[];
  scores: CompanyScore[];
  index: { code: string; close: number; asOf: string } | null;
  facts: { ticker: string; state: FactsState; fetchedOn: string | null; ageDays: number | null; error: string | null }[];
  factsMaxAgeDays: number;
};
