'use client';
// Why a company scored what it did: the four parts, each with the raw figure and what it is compared with, then what
// would change the view and the risks. Plain words only; every number comes from the public analysis already loaded.
import { ExternalLink } from 'lucide-react';
import type { CompanyScore } from '@/lib/company-facts';
import { ineligibleReason } from '@/lib/company-facts';
import type { MonthlyPick } from '@/lib/monthly-picks';
import type { SnapshotCompany } from '@/lib/monthly-picks-ai';
import { explainPick } from '@/lib/pick-explain';
import type { RowTag } from '@/lib/picks-view';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n) > 500 ? '>500' : Math.abs(n)}`;

type Part = { key: 'valuation' | 'growth' | 'profitability' | 'momentum'; label: string; weight: number; detail: string };

function parts(company: SnapshotCompany | undefined): Part[] {
  const m = company?.metrics;
  const yoy = m?.epsYoYPct ?? null;
  return [
    {
      key: 'valuation', label: 'Value', weight: 35,
      detail: !m ? 'No data.' : m.earningsYieldPct !== null && m.peTtm !== null
        ? `Earnings yield ${m.earningsYieldPct}% (P/E ${m.peTtm}). Higher is cheaper.`
        : m.epsTtm !== null && m.epsTtm <= 0 ? 'Loss-making over the last four quarters, so it ranks last on value.' : 'No P/E published.',
    },
    {
      key: 'growth', label: 'Growth', weight: 35,
      detail: yoy !== null ? `Profit per share ${signed(yoy)}% on the same quarter last year.`
        : m?.epsAnnualCagrPct != null ? `Profit per share grew ${signed(m.epsAnnualCagrPct)}% a year over the years reported.` : 'No year-ago quarter to compare with.',
    },
    {
      key: 'profitability', label: 'Margins', weight: 15,
      detail: m?.netMarginTrendPct != null ? `Net margin ${m.netMarginTrendPct >= 0 ? 'up' : 'down'} ${Math.abs(m.netMarginTrendPct)} points across the years shown.` : 'No margin history.',
    },
    {
      key: 'momentum', label: 'Momentum', weight: 15,
      detail: m?.change1yPct != null ? `Share price ${signed(m.change1yPct)}% over a year.` : 'No one-year price change.',
    },
  ];
}

export default function PicksWhy({
  ticker, company, score, pick, rank, total, tag, benchmarkSample, onOpenCompany,
}: {
  ticker: string;
  company: SnapshotCompany | undefined;
  score: CompanyScore | undefined;
  pick: MonthlyPick | undefined;
  rank: number;
  total: number;
  tag: RowTag | null;
  benchmarkSample: number | null;
  onOpenCompany: (ticker: string) => void;
}) {
  if (!company || company.metrics.unavailable)
    return (
      <div className="mp2-why__box">
        <p>{company?.metrics.unavailable ?? 'No PSX company data for this company yet.'} It cannot be ranked until the daily scrape has fetched it.</p>
      </div>
    );
  const blocked = score ? ineligibleReason(score) : null;
  const plain = pick ? explainPick(pick, rank, total) : null;
  const sources = company.source ? [{ url: company.source, title: `${ticker} PSX company page` }] : [];
  return (
    <div className="mp2-why__box">
      {score && (
        <p>
          <b>Score {Math.round(score.score)} out of 100</b>
          {tag ? ` · ${tag.text}` : ''}. {benchmarkSample ? `Each part is compared with the ${benchmarkSample} PSX companies we track.` : 'Each part is compared with the other companies on your shortlist.'}
          {blocked ? ` Not eligible for a pick: ${blocked}.` : ''}
        </p>
      )}
      <div className="mp2-parts">
        {parts(company).map((part) => {
          const value = score?.components[part.key] ?? null;
          return (
            <div className="mp2-part" key={part.key}>
              <span>{part.label} · {part.weight}%</span>
              <b>{value === null ? '—' : Math.round(value)}</b>
              <span className="mp2-bar" aria-hidden="true"><i style={{ width: `${value ?? 0}%` }} /></span>
              <small>{part.detail}</small>
            </div>
          );
        })}
      </div>
      {plain && (
        <>
          <p><b>What would change this:</b> {plain.changePoints.join(' ')}</p>
          <p><b>Risks:</b> {plain.risks.join(' ')}</p>
          {!!plain.news.length && (
            <ul aria-label="Recent announcements">
              {plain.news.map((item) => <li key={`${item.date}${item.title}`}>{item.date ? `${item.date}: ` : ''}{item.title}</li>)}
            </ul>
          )}
        </>
      )}
      <p className="mp2-note">
        Numbers only: no news is read, so check announcements before you buy.{' '}
        {sources.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} <ExternalLink size={12} /></a>
        ))}{' '}
        <button type="button" data-slot="plain" className="link-button" onClick={() => onOpenCompany(ticker)}>Open company</button>
      </p>
    </div>
  );
}
