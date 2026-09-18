'use client';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Download, Plus, Trash2, Upload, RotateCcw, Settings, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DEFAULT_RESEARCH_SETTINGS,
  REASONING_EFFORTS,
  RESEARCH_MODELS,
  today,
  type Portfolio,
  type ResearchCompany,
  type ResearchSettings,
} from '@/lib/portfolio';
import DossierExperience from './dossier-experience';
import { onRunnerEvent, startResearchRunner, getRunArchive } from './research-runner';
import { downloadRunSources } from './research-zip';

type Props = {
  portfolio: Portfolio;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
};
type Job = {
  id: string;
  ticker: string;
  companyName: string;
  sector: string;
  status:
    | 'queued'
    | 'researching'
    | 'complete'
    | 'needs_attention'
    | 'cancelled';
  stage: string;
  message: string;
  budgetUsd: number;
  spentUsd: number;
  reportsFound: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  claimed: boolean;
};
type Event = { id: number; stage: string; message: string; created_at: string };
const STAGE_SEQUENCE = [
  'waiting',
  'verifying',
  'finding_reports',
  'downloading',
  'extracting',
  'analyzing',
  'validating',
  'saving',
  'complete',
] as const;
const textValue = (value: unknown, fallback = '') =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
const blank = (ticker: string): ResearchCompany => ({
  ticker,
  status: 'Queue',
  score: null,
  fairValue: null,
  fairValueLow: null,
  fairValueHigh: null,
  thesis: '',
  risks: '',
  catalysts: '',
  conversationUrl: '',
  sources: [],
  financials: [],
  updatedAt: today(),
});
const stageLabel: Record<string, string> = {
  waiting: 'Queued',
  verifying: 'Verifying company',
  finding_reports: 'Finding reports',
  downloading: 'Downloading reports',
  extracting: 'Extracting financials',
  analyzing: 'Analyzing',
  validating: 'Validating dossier',
  saving: 'Saving dossier',
  complete: 'Complete',
  needs_attention: 'Needs attention',
  cancelled: 'Cancelled',
};
function elapsed(start: string | null, end?: string | null) {
  if (!start) return 'Not started';
  const seconds = Math.max(
    0,
    Math.floor(
      (new Date(end || Date.now()).getTime() - new Date(start).getTime()) /
        1000,
    ),
  );
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export default function ResearchDesk({ portfolio, onSave }: Props) {
  const [selected, setSelected] = useState<string | null>(null),
    [draft, setDraft] = useState<ResearchCompany | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [jobOpen, setJobOpen] = useState<Job | null>(null),
    [addOpen, setAddOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsDraft, setSettingsDraft] = useState<ResearchSettings>(
      DEFAULT_RESEARCH_SETTINGS,
    ),
    [ticker, setTicker] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const settings = useMemo(
    () => portfolio.researchSettings ?? DEFAULT_RESEARCH_SETTINGS,
    [portfolio.researchSettings],
  );
  const research = useMemo(
    () => portfolio.research ?? [],
    [portfolio.research],
  );
  const open = useCallback(
    (value: string) => {
      const dossier =
        research.find((item) => item.ticker === value) ?? blank(value);
      setSelected(value);
      setDraft(structuredClone(dossier));
    },
    [research],
  );
  const loadJobs = useCallback(
    async (jobId?: string) => {
      const response = await fetch(
          '/api/research/jobs' +
            (jobId ? `?job=${encodeURIComponent(jobId)}` : ''),
          { cache: 'no-store' },
        ),
        data = (await response.json()) as {
          error?: string;
          jobs: Job[];
          events?: Event[];
        };
      if (!response.ok)
        throw Error(data.error || 'Research progress is unavailable.');
      setJobs(data.jobs);
      if (jobId) setEvents(data.events || []);
      const completed = data.jobs.find(
        (job) =>
          job.status === 'complete' &&
          research.find((item) => item.ticker === job.ticker)?.status !==
            'Complete',
      );
      if (completed) {
        sessionStorage.setItem('open-completed-dossier', completed.ticker);
        window.location.reload();
      }
      if (jobId) setJobOpen(data.jobs.find((job) => job.id === jobId) || null);
    },
    [research],
  );
  useEffect(() => {
    const first = window.setTimeout(() => void loadJobs().catch(() => {}), 0);
    const timer = window.setInterval(
      () => void loadJobs(jobOpen?.id).catch(() => {}),
      10000,
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [jobOpen?.id, loadJobs]);
  useEffect(() => {
    const stop = startResearchRunner();
    const unsubscribe = onRunnerEvent(({ jobId, stage, message, reportsFound }) => {
      const patch = { stage, message, reportsFound, claimed: true };
      setJobs((prev) =>
        prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
      );
      setJobOpen((prev) => (prev && prev.id === jobId ? { ...prev, ...patch } : prev));
    });
    return () => {
      stop();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const value = sessionStorage.getItem('open-completed-dossier');
    if (
      value &&
      research.some(
        (item) => item.ticker === value && item.status === 'Complete',
      )
    ) {
      sessionStorage.removeItem('open-completed-dossier');
      window.queueMicrotask(() => open(value));
    }
  }, [open, research]);
  const latestJob = useMemo(
    () => {
      const latest = new Map<string, Job>();
      for (const job of jobs) if (!latest.has(job.ticker)) latest.set(job.ticker, job);
      return latest;
    },
    [jobs],
  );
  const rows = useMemo(() => {
    const tickers = new Set([
      ...research.map((item) => item.ticker),
      ...jobs.map((job) => job.ticker),
    ]);
    return [...tickers].map((value) => ({
      ticker: value,
      dossier: research.find((item) => item.ticker === value),
      job: latestJob.get(value),
      company: portfolio.companies.find((item) => item.ticker === value),
    }));
  }, [research, jobs, latestJob, portfolio.companies]);
  const save = async (value = draft) => {
    if (!value) return;
    const next = structuredClone(portfolio);
    next.research = [
      ...(next.research ?? []).filter((item) => item.ticker !== value.ticker),
      { ...value, updatedAt: today() },
    ];
    await onSave(next, `${value.ticker} research dossier saved.`);
  };
  const startResearch = async (refreshTicker?: string) => {
    const value = (refreshTicker || ticker).trim().toUpperCase(),
      complete = research.find(
        (item) => item.ticker === value && item.status === 'Complete',
      );
    if (complete && !refreshTicker) {
      setAddOpen(false);
      open(value);
      return;
    }
    const active = latestJob.get(value);
    if (active && !['cancelled', 'complete'].includes(active.status)) {
      setAddOpen(false);
      setJobOpen(active);
      await loadJobs(active.id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/research/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: value }),
        }),
        data = (await response.json()) as { error?: string; job: Job };
      if (!response.ok)
        throw Error(data.error || 'Research could not be started.');
      setTicker('');
      setAddOpen(false);
      setJobOpen(data.job);
      await loadJobs(data.job.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Research could not be started.',
      );
    } finally {
      setBusy(false);
    }
  };
  const action = async (job: Job, name: 'cancel' | 'resume') => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/research/jobs', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id, action: name }),
        }),
        data = (await response.json()) as { error?: string; job: Job };
      if (!response.ok)
        throw Error(data.error || 'Research could not be updated.');
      setJobOpen(data.job);
      await loadJobs(job.id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Research could not be updated.',
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteResearch = async (value: string) => {
    if (!window.confirm(`Delete all research for ${value}? This cannot be undone.`))
      return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
          `/api/research/jobs?ticker=${encodeURIComponent(value)}`,
          { method: 'DELETE' },
        ),
        data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw Error(data.error || 'Research could not be deleted.');
      setJobs((prev) => prev.filter((job) => job.ticker !== value));
      const next = structuredClone(portfolio);
      next.research = (next.research ?? []).filter(
        (item) => item.ticker !== value,
      );
      await onSave(next, `${value} research deleted.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Research could not be deleted.',
      );
    } finally {
      setBusy(false);
    }
  };
  const saveSettings = async () => {
    setBusy(true);
    setError('');
    try {
      const next = structuredClone(portfolio);
      next.researchSettings = settingsDraft;
      await onSave(next, 'Research settings updated.');
      setSettingsOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Research settings could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };
  const exportDossier = () => {
    if (!draft) return;
    const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                schemaVersion: 1,
                kind: 'psx-company-dossier',
                exportedAt: new Date().toISOString(),
                company: draft,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      ),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${draft.ticker}-research-dossier.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 800);
  };
  const importLegacy = async (file: File) => {
    const data = JSON.parse(await file.text()) as {
      schemaVersion?: number;
      companies?: Array<Record<string, unknown>>;
    };
    if (data.schemaVersion !== 1 || !Array.isArray(data.companies))
      throw Error('Choose a PSX Research Desk backup with schema version 1.');
    const next = structuredClone(portfolio);
    const imported: ResearchCompany[] = data.companies
      .map((company) => ({
        ticker: textValue(company.ticker).toUpperCase(),
        status: ['Queue', 'Researching', 'Complete', 'Update needed'].includes(
          textValue(company.status),
        )
          ? (textValue(company.status) as ResearchCompany['status'])
          : 'Queue',
        score:
          typeof company.scores === 'object' && company.scores
            ? Object.values(
                company.scores as Record<string, unknown>,
              ).reduce<number>(
                (sum, value) => sum + (typeof value === 'number' ? value : 0),
                0,
              )
            : null,
        fairValue: null,
        fairValueLow: null,
        fairValueHigh: null,
        thesis: textValue(company.thesis),
        risks: textValue(company.risk),
        catalysts: textValue(company.catalyst),
        conversationUrl: textValue(company.conversation),
        sources: Array.isArray(company.documents)
          ? company.documents
              .map((document) =>
                typeof document === 'object' && document
                  ? textValue((document as Record<string, unknown>).url)
                  : '',
              )
              .filter(Boolean)
          : [],
        financials: Array.isArray(company.financials)
          ? company.financials.map((financial) => {
              const item = financial as Record<string, unknown>;
              return {
                year: textValue(item.year),
                revenue: typeof item.revenue === 'number' ? item.revenue : null,
                profit: typeof item.profit === 'number' ? item.profit : null,
                eps: typeof item.eps === 'number' ? item.eps : null,
                roe: null,
                debt: typeof item.debt === 'number' ? item.debt : null,
              };
            })
          : [],
        updatedAt: textValue(company.week, today()),
        details: company,
      }))
      .filter((item) => /^[A-Z0-9]{2,12}$/.test(item.ticker));
    for (const company of data.companies) {
      const value = textValue(company.ticker).toUpperCase();
      if (
        /^[A-Z0-9]{2,12}$/.test(value) &&
        !next.companies.some((item) => item.ticker === value)
      )
        next.companies.push({
          ticker: value,
          name: textValue(company.name, value),
          sector: '',
          target: 0,
          approved: false,
          screenDate: '',
          note: 'Added from PSX Research Desk backup.',
        });
    }
    next.research = [
      ...(next.research ?? []).filter(
        (item) => !imported.some((value) => value.ticker === item.ticker),
      ),
      ...imported,
    ];
    await onSave(
      next,
      `${imported.length} research dossiers imported into this unified app.`,
    );
  };
  if (selected && draft)
    return (
      <DossierExperience
        draft={draft}
        company={portfolio.companies.find(
          (company) => company.ticker === draft.ticker,
        )}
        onChange={setDraft}
        onBack={() => setSelected(null)}
        onSave={save}
        onExport={exportDossier}
      />
    );
  const researchingCount = jobs.filter((job) =>
    ['queued', 'researching'].includes(job.status),
  ).length;
  const completeCount = research.filter(
    (item) => item.status === 'Complete',
  ).length;
  const attentionCount =
    jobs.filter((job) => job.status === 'needs_attention').length +
    research.filter((item) => item.status === 'Update needed').length;
  return (
    <section className="research-queue">
      <div className="research-hero">
        <div>
          <p className="eyebrow">PSX RESEARCH DESK</p>
          <h2>Research queue &amp; dossiers</h2>
          <p>Start cited company research and follow each saved stage.</p>
        </div>
        <div className="row">
          <button
            className="secondary"
            onClick={() => {
              setSettingsDraft(settings);
              setSettingsOpen(true);
              setError('');
            }}
          >
            <Settings size={16} /> Settings
          </button>
          <label className="import-label">
            <Upload size={15} /> Import research backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void importLegacy(file).catch((reason) =>
                    alert(
                      reason instanceof Error ? reason.message : String(reason),
                    ),
                  );
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button
            onClick={() => {
              setAddOpen(true);
              setError('');
            }}
          >
            <Plus size={16} /> Add dossier
          </button>
        </div>
      </div>
      <section className="metrics research-metrics">
        <article>
          <span>Researching</span>
          <strong>{researchingCount}</strong>
        </article>
        <article className={completeCount ? 'stat-pos' : ''}>
          <span>Complete</span>
          <strong>{completeCount}</strong>
        </article>
        <article className={attentionCount ? 'stat-neg' : ''}>
          <span>Needs attention</span>
          <strong>{attentionCount}</strong>
        </article>
      </section>
      <section className="panel table-panel">
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>Score</th>
                <th>Reports</th>
                <th>Last activity</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ticker: value, dossier, job, company }) => {
                const active =
                  job && !['complete', 'cancelled'].includes(job.status);
                const needsAttention =
                  job?.status === 'needs_attention' ||
                  dossier?.status === 'Update needed';
                return (
                  <tr key={value} className={needsAttention ? 'row-attention' : ''}>
                    <td>
                      <span className="ticker">{value}</span>
                      <small>{job?.companyName || company?.name}</small>
                    </td>
                    <td>
                      <span
                        className={`tag status-${job?.status || dossier?.status.toLowerCase().replace(' ', '-')}`}
                      >
                        {active
                          ? stageLabel[job.stage] || job.message
                          : dossier?.status ||
                            stageLabel[job?.stage || ''] ||
                            'Queue'}
                      </span>
                      {active && !job.claimed && (
                        <small className="helper-offline">
                          Open Research desk to process
                        </small>
                      )}
                    </td>
                    <td>{dossier?.score ?? '—'}</td>
                    <td>{job?.reportsFound ?? dossier?.sources.length ?? 0}</td>
                    <td>
                      {job?.updatedAt.slice(0, 16).replace('T', ' ') ||
                        dossier?.updatedAt ||
                        '—'}
                    </td>
                    <td>
                      <div className="row">
                        <button
                          className="secondary compact"
                          onClick={() => {
                            if (active || job?.status === 'needs_attention') {
                              setJobOpen(job!);
                              void loadJobs(job!.id);
                            } else open(value);
                          }}
                        >
                          {active || job?.status === 'needs_attention'
                            ? 'View progress'
                            : 'Open'}
                        </button>
                        {dossier?.status === 'Complete' && !active && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() => void startResearch(value)}
                          >
                            <RotateCcw size={14} /> Refresh research
                          </button>
                        )}
                        {!active && (
                          <button
                            className="secondary compact"
                            disabled={busy}
                            onClick={() => void deleteResearch(value)}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="form-dialog">
          <DialogTitle>Research a PSX company</DialogTitle>
          <DialogDescription>
            Enter the ticker. The dossier appears immediately and research
            continues automatically while this tab (or any other Research
            desk tab you have open) stays open.
          </DialogDescription>
          <label>
            Company ticker
            <input
              value={ticker}
              maxLength={12}
              placeholder="MEBL"
              onChange={(event) =>
                setTicker(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') void startResearch();
              }}
            />
          </label>
          <p className="help">
            Each run is capped at US${settings.budgetUsd.toFixed(2)} using{' '}
            {settings.model}. Existing reports are reused.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              disabled={busy || ticker.length < 2}
              onClick={() => void startResearch()}
            >
              {busy ? 'Checking ticker…' : 'Start research'}
            </button>
            <button className="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="form-dialog">
          <DialogTitle>Research settings</DialogTitle>
          <DialogDescription>
            Applies to every research run started after you save. Jobs
            already queued or in progress keep the settings they started
            with.
          </DialogDescription>
          <label>
            AI model
            <select
              value={settingsDraft.model}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  model: event.target.value as ResearchSettings['model'],
                })
              }
            >
              {RESEARCH_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reasoning effort
            <select
              value={settingsDraft.reasoningEffort}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  reasoningEffort: event.target
                    .value as ResearchSettings['reasoningEffort'],
                })
              }
            >
              {REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label>
            Budget limit per run (US$)
            <input
              type="number"
              min={0.05}
              max={5}
              step={0.05}
              value={settingsDraft.budgetUsd}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  budgetUsd: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Max output tokens
            <input
              type="number"
              min={4000}
              max={64000}
              step={1000}
              value={settingsDraft.maxOutputTokens}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  maxOutputTokens: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Self-correction attempts
            <input
              type="number"
              min={1}
              max={5}
              step={1}
              value={settingsDraft.maxAttempts}
              onChange={(event) =>
                setSettingsDraft({
                  ...settingsDraft,
                  maxAttempts: Number(event.target.value),
                })
              }
            />
          </label>
          <p className="help">
            A validation failure gets fed back to the model for another try,
            up to this many attempts, before a job is flagged for manual
            review.
          </p>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button disabled={busy} onClick={() => void saveSettings()}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            <button
              className="secondary"
              onClick={() => setSettingsOpen(false)}
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!jobOpen}
        onOpenChange={(openValue) => {
          if (!openValue) {
            setJobOpen(null);
            setEvents([]);
          }
        }}
      >
        <DialogContent className="form-dialog research-progress">
          <DialogTitle>{jobOpen?.ticker} research progress</DialogTitle>
          <DialogDescription>{jobOpen?.companyName}</DialogDescription>
          {jobOpen && (
            <>
              {!['needs_attention', 'cancelled'].includes(jobOpen.status) && (
                <div className="stage-track">
                  {STAGE_SEQUENCE.map((stage) => {
                    const currentIndex = STAGE_SEQUENCE.indexOf(
                      jobOpen.stage as (typeof STAGE_SEQUENCE)[number],
                    );
                    const stageIndex = STAGE_SEQUENCE.indexOf(stage);
                    const state =
                      stageIndex < currentIndex
                        ? 'done'
                        : stageIndex === currentIndex
                          ? 'active'
                          : 'pending';
                    return <span key={stage} className={`stage-step ${state}`} />;
                  })}
                </div>
              )}
              <div className="current-stage">
                <span className={`job-dot ${jobOpen.status}`} />
                <div>
                  <b>{stageLabel[jobOpen.stage] || jobOpen.message}</b>
                  <p>{jobOpen.message}</p>
                </div>
                <div
                  className="spend-gauge"
                  style={
                    {
                      '--pct': Math.min(100, (jobOpen.spentUsd / 0.5) * 100),
                    } as CSSProperties
                  }
                >
                  <div className="spend-gauge-hole">
                    <b>${jobOpen.spentUsd.toFixed(2)}</b>
                    <small>/ $0.50</small>
                  </div>
                </div>
              </div>
              <div className="job-facts">
                <div>
                  <span>Reports found</span>
                  <b>{jobOpen.reportsFound}</b>
                </div>
                <div>
                  <span>Elapsed</span>
                  <b>{elapsed(jobOpen.startedAt, jobOpen.completedAt)}</b>
                </div>
                <div>
                  <span>Processing</span>
                  <b>{jobOpen.claimed ? 'This tab' : 'Not yet claimed'}</b>
                </div>
              </div>
              {!jobOpen.claimed &&
                ['queued', 'researching'].includes(jobOpen.status) && (
                  <p className="notice">
                    Queued. Research starts automatically as soon as a
                    Research desk tab is open — this one, or any other.
                  </p>
                )}
              {jobOpen.error && <p className="notice error">{jobOpen.error}</p>}
              <div className="event-list">
                {events.map((item) => (
                  <div key={item.id}>
                    <span className="event-mark" />
                    <div>
                      <b>{stageLabel[item.stage] || item.stage}</b>
                      <p>{item.message}</p>
                      <small>
                        {new Date(item.created_at).toLocaleString()}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row">
                {jobOpen.status === 'needs_attention' && (
                  <button
                    disabled={busy || jobOpen.spentUsd >= 0.5}
                    onClick={() => void action(jobOpen, 'resume')}
                  >
                    <RotateCcw size={15} /> Resume
                  </button>
                )}
                {['queued', 'researching'].includes(jobOpen.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action(jobOpen, 'cancel')}
                  >
                    <X size={15} /> Cancel research
                  </button>
                )}
                {jobOpen.status === 'complete' && getRunArchive(jobOpen.id) && (
                  <button
                    className="secondary"
                    onClick={() => downloadRunSources(jobOpen.id)}
                  >
                    <Download size={15} /> Download sources
                  </button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
