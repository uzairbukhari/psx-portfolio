// Plain-English explanation of a Monthly Pick, built from the numbers already on the card so it also works
// for runs saved before this wording existed. Pure text: no data is fetched and nothing is judged beyond
// what the figures say.
import type { MonthlyPick } from './monthly-picks.ts';

export type PickExplanation = {
  /** Short plain summary shown under the numbers. */
  summary: string;
  /** One short sentence on where it ranked, then one sentence per fact. */
  headline: string;
  whyPoints: string[];
  changePoints: string[];
  risks: string[];
  news: { date: string; title: string }[];
  newsNote: string;
};

const abs = (n: number) => Math.round(Math.abs(n) * 100) / 100;

/** PSX prints announcement titles in capitals; make them readable. */
export function readableTitle(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text || text !== text.toUpperCase()) return text;
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function valuation(pe: number | null): { text: string; cheap: boolean; pricey: boolean } | null {
  if (pe === null || !(pe > 0)) return null;
  const tag = pe < 8 ? 'which is low' : pe <= 15 ? 'which is about average' : 'which is on the high side';
  return {
    text: `The share price is about ${abs(pe)} times what the company earns in a year (this is called the P/E ratio), ${tag}. A lower number means you pay less for each rupee of profit.`,
    cheap: pe < 8, pricey: pe > 15,
  };
}

function growth(eps: number | null): { text: string; up: boolean; down: boolean } | null {
  if (eps === null) return null;
  if (eps > 0) return { text: `Its profit per share grew ${abs(eps)}% compared with a year ago.`, up: true, down: false };
  if (eps < 0) return { text: `Its profit per share fell ${abs(eps)}% compared with a year ago.`, up: false, down: true };
  return { text: 'Its profit per share is about the same as a year ago.', up: false, down: false };
}

function momentum(change: number | null): { text: string; up: boolean; down: boolean } | null {
  if (change === null) return null;
  if (change > 0) return { text: `The share price is up ${abs(change)}% over the past year.`, up: true, down: false };
  if (change < 0) return { text: `The share price is down ${abs(change)}% over the past year.`, up: false, down: true };
  return { text: 'The share price is about where it was a year ago.', up: false, down: false };
}

const CONFIDENCE: Record<MonthlyPick['confidence'], string> = {
  High: 'We have good data on this company, so the score is fairly dependable.',
  Medium: 'Some data is missing or mixed, so treat the score as a rough guide.',
  Low: 'Data is thin or the numbers disagree, so treat the score with extra care.',
};

export function explainPick(pick: MonthlyPick, rank: number, total: number): PickExplanation {
  const m = pick.metrics;
  const value = valuation(m?.peTtm ?? null);
  const grow = growth(m?.epsYoYPct ?? null);
  const move = momentum(m?.change1yPct ?? null);
  const facts = [value?.text, grow?.text, move?.text].filter((x): x is string => !!x);

  const score = m?.score != null ? ` It scored ${abs(m.score)} out of 100.` : '';
  const headline = `It came ${rank === 1 ? 'first' : `number ${rank}`} out of ${total} ${total === 1 ? 'company' : 'companies'} on your list.${score}`;
  const whyPoints = facts.length ? [...facts, CONFIDENCE[pick.confidence]] : [pick.whySelected ?? 'Ranked by its score among your list.'];

  const changePoints: string[] = [];
  if (grow?.up) changePoints.push('The next results show profits falling instead of growing.');
  else if (grow?.down) changePoints.push('The next results show profits recovering.');
  if (value?.cheap) changePoints.push('The share price rises sharply, so it is no longer cheap compared with its profit.');
  else if (value?.pricey) changePoints.push('The share price falls back, making it cheaper compared with its profit.');
  if (move?.down) changePoints.push('The price stops falling and starts to recover.');
  else if (move?.up) changePoints.push('The price drops quickly after a long climb.');
  if (!changePoints.length) changePoints.push(pick.invalidation ?? 'New company results or a big move in the share price could change this view.');
  changePoints.push('We re-check the numbers every time you run Monthly Picks.');

  const risks: string[] = [];
  if (value?.cheap) risks.push('A very low price compared with profit can mean investors expect profits to fall. Cheap shares are not always bargains.');
  if (value?.pricey) risks.push('The price is already high compared with profit, so there is less room for good surprises.');
  if (grow?.down) risks.push('Profit per share is falling, which can push the share price lower.');
  if (move?.down) risks.push('The share price has been falling over the past year, and it could keep falling.');
  if (pick.confidence !== 'High') risks.push(CONFIDENCE[pick.confidence]);
  risks.push('This ranking looks only at numbers from PSX. It has not read news or judged the company’s management.');
  risks.push('Share prices go up and down. You can get back less than you put in.');

  const news = pick.catalysts.map((line) => {
    const match = /^(\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2}, \d{4}):\s*(.*)$/.exec(line);
    return match ? { date: match[1], title: readableTitle(match[2]) } : { date: '', title: readableTitle(line) };
  });
  const newsNote = news.length
    ? 'These are the company’s latest filings with PSX. We list them but have not judged whether they are good or bad news.'
    : 'No recent company announcements were found for this pick.';

  const summary = [grow?.text, move?.text].filter((x): x is string => !!x).join(' ') || value?.text || pick.thesis;
  return { summary, headline, whyPoints, changePoints, risks, news, newsNote };
}
