export type Financial = {
  year: number;
  revenue: number | null;
  profit: number | null;
  eps: number | null;
  ocf: number | null;
  debt: number | null;
  equity: number | null;
  dividend: number | null;
  source: string;
  page: string;
  basis: string;
  verified: boolean;
};
export type Company = {
  schemaVersion?: 1 | 2;
  ticker: string;
  name: string;
  sector: string;
  demo: boolean;
  status: string;
  week: string;
  price: number | null;
  priceDate: string;
  financials: Financial[];
  scores: (number | null)[];
  scoreNotes: string[];
  scoreRubric?: { name: string; max: number }[];
  thesis: string;
  risk: string;
  catalyst: string;
  conversation: string;
  documents: { title: string; url: string; kind: string; date: string }[];
  history: { date: string; text: string }[];
  scenarios: { name: string; eps: number | null; multiple: number | null }[];
  confidence?: string;
  missingInformation?: string[];
  researchNarrative?: string;
};
export const statuses = ['Queued', 'Researching', 'Complete', 'Update needed'];
export const rubric = [
  ['Business quality', 25],
  ['Financial strength', 25],
  ['Growth & durability', 20],
  ['Governance', 15],
  ['Valuation', 15],
] as const;
export const score = (c: Company) =>
  c.scores.every((n) => n !== null)
    ? c.scores.reduce<number>((a, b) => a + (b ?? 0), 0)
    : null;
export const money = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-PK', { maximumFractionDigits: 2 });
export function blank(ticker: string, name: string, sector: string): Company {
  return {
    ticker,
    name,
    sector,
    demo: false,
    status: 'Queued',
    week: '',
    price: null,
    priceDate: '',
    financials: [],
    scores: [null, null, null, null, null],
    scoreNotes: ['', '', '', '', ''],
    thesis: '',
    risk: '',
    catalyst: '',
    conversation: '',
    documents: [],
    history: [{ date: new Date().toISOString(), text: 'Dossier created' }],
    scenarios: ['Bear', 'Base', 'Bull'].map((name) => ({
      name,
      eps: null,
      multiple: null,
    })),
  };
}
export function safeUrl(s: string) {
  try {
    return ['https:', 'http:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}
