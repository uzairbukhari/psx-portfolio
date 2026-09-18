import { db } from '@/lib/server';
import {
  DEFAULT_RESEARCH_SETTINGS,
  REASONING_EFFORTS,
  RESEARCH_MODELS,
  type ResearchSettings,
} from '@/lib/portfolio';

export const ACTIVE_JOB_STATUSES = [
  'queued',
  'researching',
  'needs_attention',
] as const;
export const RESEARCH_STAGES = [
  'waiting',
  'verifying',
  'finding_reports',
  'downloading',
  'extracting',
  'analyzing',
  'validating',
  'saving',
  'complete',
  'needs_attention',
  'cancelled',
] as const;

export type ResearchStage = (typeof RESEARCH_STAGES)[number];
export type ResearchJobStatus =
  | 'queued'
  | 'researching'
  | 'complete'
  | 'needs_attention'
  | 'cancelled';

export type ResearchJobRow = {
  id: string;
  user_id: string;
  ticker: string;
  company_name: string;
  sector: string;
  status: ResearchJobStatus;
  stage: ResearchStage;
  message: string;
  budget_micros: number;
  spent_micros: number;
  reports_found: number;
  checkpoint: string | null;
  result: string | null;
  error: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export function publicJob(row: ResearchJobRow) {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.company_name,
    sector: row.sector,
    status: row.status,
    stage: row.stage,
    message: row.message,
    budgetUsd: row.budget_micros / 1_000_000,
    spentUsd: row.spent_micros / 1_000_000,
    reportsFound: row.reports_found,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    claimed:
      row.status === 'researching' &&
      !!row.lease_until &&
      row.lease_until > new Date().toISOString(),
  };
}

export async function addEvent(jobId: string, stage: string, message: string) {
  await db()
    .prepare(
      'INSERT INTO research_events (job_id,stage,message,created_at) VALUES (?,?,?,?)',
    )
    .bind(jobId, stage, message.slice(0, 1000), new Date().toISOString())
    .run();
}

export function tickerOK(value: string) {
  return /^[A-Z0-9]{2,12}$/.test(value);
}

export async function resolveResearchSettings(
  userId: string,
): Promise<ResearchSettings> {
  const saved = await db()
    .prepare('SELECT payload FROM portfolios WHERE user_id=?')
    .bind(userId)
    .first<{ payload: string }>();
  if (!saved) return DEFAULT_RESEARCH_SETTINGS;
  try {
    const portfolio = JSON.parse(saved.payload) as {
      researchSettings?: Partial<ResearchSettings>;
    };
    const s = portfolio.researchSettings;
    if (
      !s ||
      !RESEARCH_MODELS.includes(s.model as never) ||
      !REASONING_EFFORTS.includes(s.reasoningEffort as never) ||
      !Number.isFinite(s.maxOutputTokens) ||
      !Number.isFinite(s.budgetUsd) ||
      !Number.isInteger(s.maxAttempts)
    )
      return DEFAULT_RESEARCH_SETTINGS;
    return s as ResearchSettings;
  } catch {
    return DEFAULT_RESEARCH_SETTINGS;
  }
}
