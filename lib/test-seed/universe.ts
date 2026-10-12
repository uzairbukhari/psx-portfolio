// The fictional world the test seed lives in: which companies, funds and metals exist. Shared by the private account
// (lib/test-seed/account.ts) and the public-data fixtures (lib/test-seed/public-fixtures.ts) so they cannot drift.
// Company tickers are real PSX symbols so staging's real scrapers can fill them; fund ids are fictional on purpose
// (990001+) so they never collide with a real MUFAP fund.

export const TEST_COMPANIES = [
  { ticker: 'MEBL', name: 'Meezan Bank', sector: 'Bank', price: 320, faceValue: 10 },
  { ticker: 'HBL', name: 'Habib Bank', sector: 'Bank', price: 215, faceValue: 10 },
  { ticker: 'LUCK', name: 'Lucky Cement', sector: 'Cement', price: 1150, faceValue: 10 },
  { ticker: 'FCCL', name: 'Fauji Cement', sector: 'Cement', price: 52, faceValue: 10 },
  { ticker: 'OGDC', name: 'Oil & Gas Development', sector: 'Oil & Gas', price: 230, faceValue: 10 },
  { ticker: 'PPL', name: 'Pakistan Petroleum', sector: 'Oil & Gas', price: 190, faceValue: 10 },
  { ticker: 'PSO', name: 'Pakistan State Oil', sector: 'Oil & Gas', price: 410, faceValue: 10 },
  { ticker: 'HUBC', name: 'Hub Power', sector: 'Others', price: 210, faceValue: 10 },
  { ticker: 'EFERT', name: 'Engro Fertilizers', sector: 'Fertilizer', price: 245, faceValue: 10 },
  { ticker: 'FFC', name: 'Fauji Fertilizer', sector: 'Fertilizer', price: 430, faceValue: 10 },
  { ticker: 'SYS', name: 'Systems', sector: 'Technology', price: 135, faceValue: 10 },
  { ticker: 'AIRLINK', name: 'Air Link Communication', sector: 'Technology', price: 95, faceValue: 10 },
  { ticker: 'SEARL', name: 'The Searle Company', sector: 'Pharma', price: 78, faceValue: 10 },
  { ticker: 'INDU', name: 'Indus Motor', sector: 'Auto', price: 2150, faceValue: 10 },
  { ticker: 'TRG', name: 'TRG Pakistan', sector: 'Technology', price: 75, faceValue: 10 },
] as const;
export const TEST_TICKERS: string[] = TEST_COMPANIES.map((c) => c.ticker);
export const priceOf = (ticker: string) => TEST_COMPANIES.find((c) => c.ticker === ticker)?.price ?? 100;

export const TEST_FUNDS = [
  { mufapId: '990001', amc: 'Test Asset Management', fundName: 'Test Money Market Fund', category: 'Money Market', nav: 101.25, repurchase: 101.25, offer: 101.25 },
  { mufapId: '990002', amc: 'Test Asset Management', fundName: 'Test Equity Fund', category: 'Equity', nav: 142.8, repurchase: 142.8, offer: 146.1 },
  { mufapId: '990003', amc: 'Sample Investments', fundName: 'Sample Income Fund', category: 'Income', nav: 55.4, repurchase: 55.4, offer: 55.4 },
] as const;

export const TEST_METAL_RATES = {
  goldPerTola24k: 345000,
  goldPerTola22k: 316250,
  silverPerTola: 4100,
  goldSpotUsdPerOz: 3350,
  silverSpotUsdPerOz: 38,
} as const;
