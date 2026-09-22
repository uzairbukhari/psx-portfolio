'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, animate, stagger } from 'framer-motion';
import {
  Sparkles,
  ArrowUp,
  ArrowDown,
  Check,
  Lock,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Loader2,
  Radar,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  money,
  today,
  reviewPrompt,
  researchInsights,
  validateReview,
  type Portfolio,
} from '@/lib/portfolio';
import { researchPlan } from '@/lib/decision';

type Props = {
  portfolio: Portfolio;
  revision: number;
  month: string;
  busy: boolean;
  reviewBusy: boolean;
  setReviewBusy: (value: boolean) => void;
  proposal: { summary: string; weights: Record<string, number> } | null;
  setProposal: (
    value: { summary: string; weights: Record<string, number> } | null,
  ) => void;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
  onApplied: () => void;
};
type ReviewResponse = {
  error?: string;
  revision: number;
  cached?: boolean;
  estimatedCostUsd?: number;
  summary?: string;
  weights?: Record<string, number>;
};

const clone = (p: Portfolio): Portfolio => JSON.parse(JSON.stringify(p));
function download(name: string, data: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const STEPS = [
  { label: 'Coverage', hint: 'Research readiness' },
  { label: 'Generate', hint: 'Run or import a review' },
  { label: 'Review', hint: 'Inspect proposed targets' },
  { label: 'Apply', hint: 'Commit to portfolio' },
] as const;

export default function AiReview({
  portfolio: p,
  revision,
  month,
  busy,
  reviewBusy,
  setReviewBusy,
  proposal,
  setProposal,
  onSave,
  onApplied,
}: Props) {
  const [aiAvailable, setAiAvailable] = useState(false),
    [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [aiText, setAiText] = useState(''),
    [promptOpen, setPromptOpen] = useState(false),
    [step, setStep] = useState(0),
    [evidenceOpen, setEvidenceOpen] = useState(true),
    [ringValue, setRingValue] = useState(0);

  useEffect(() => {
    fetch('/api/review')
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((d) => setAiAvailable(!!d.available))
      .catch(() => {});
  }, []);

  function notify(s: string, error = false) {
    setMessage(s);
    setFailed(error);
  }

  const currentPlan = p.researchPolicy?.enabled
    ? researchPlan(p, p.researchPolicy, month, 0, today())
    : undefined;
  const budget = p.budgets[month] ?? 100000;
  const shortlistTickers = p.companies
    .filter((c) => c.target > 0)
    .map((c) => c.ticker);
  const research = researchInsights(p, shortlistTickers);
  const researched = research.filter((r) => r.status === 'Complete');
  const excluded = p.companies.filter(
    (c) => shortlistTickers.includes(c.ticker) && !c.approved,
  );
  const coveragePercent = shortlistTickers.length
    ? Math.round((researched.length / shortlistTickers.length) * 100)
    : 0;

  useEffect(() => {
    const controls = animate(0, coveragePercent, {
      duration: 1.1,
      ease: 'easeOut',
      onUpdate: (v) => setRingValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [coveragePercent]);

  const hasProposal = !!proposal;
  const hasHistory = !!p.aiReview;
  const unlockedMax = hasProposal || hasHistory ? 3 : 1;
  function goStep(i: number) {
    if (i <= unlockedMax) setStep(i);
  }

  async function aiReview() {
    setReviewBusy(true);
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, revision }),
      });
      const d = (await r.json()) as ReviewResponse;
      if (!r.ok) throw Error(d.error);
      if (d.revision !== revision)
        throw Error('Portfolio changed. Run the review again.');
      setProposal(validateReview(d, p));
      notify(
        d.cached
          ? 'Saved review reused · no new API charge.'
          : `AI review ready · estimated API cost $${(d.estimatedCostUsd ?? 0).toFixed(6)}. Inspect the reasoning before applying targets.`,
      );
      setStep(2);
    } catch (e) {
      notify(String(e), true);
    } finally {
      setReviewBusy(false);
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    try {
      const next = clone(p);
      next.companies = next.companies.map((c) => ({
        ...c,
        target: proposal.weights[c.ticker] ?? c.target,
      }));
      next.aiReview = {
        ...proposal,
        generatedAt: new Date().toISOString(),
        snapshot: JSON.stringify({ revision, month }),
      };
      await onSave(
        next,
        'Reviewed AI targets applied. Purchase eligibility remains your decision.',
      );
      onApplied();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), true);
    }
  }

  return (
    <div className="review">
      <nav className="review-stepper" aria-label="AI review steps">
        {STEPS.map((s, i) => {
          const status =
            i === step ? 'current' : i < step ? 'done' : i <= unlockedMax ? 'upcoming' : 'locked';
          return (
            <button
              key={s.label}
              type="button"
              className="review-step"
              data-status={status}
              disabled={status === 'locked'}
              onClick={() => goStep(i)}
            >
              <span className="review-step-icon">
                {status === 'done' ? (
                  <Check size={14} />
                ) : status === 'locked' ? (
                  <Lock size={12} />
                ) : (
                  i + 1
                )}
              </span>
              <span className="review-step-copy">
                <b>{s.label}</b>
                <small>{s.hint}</small>
              </span>
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {step === 0 && (
            <section className="review-panel">
              <p className="eyebrow">
                <Radar size={14} /> RESEARCH STATUS · LIVE
              </p>
              <div className="review-coverage">
                <div
                  className="review-ring"
                  style={{ '--pct': ringValue } as React.CSSProperties}
                >
                  <span>
                    {researched.length}
                    <small>/{shortlistTickers.length}</small>
                  </span>
                </div>
                <div className="review-coverage-stats">
                  <div className="review-stat-chip">
                    <span>Shortlisted</span>
                    <b>{shortlistTickers.length}</b>
                  </div>
                  <div className="review-stat-chip pos">
                    <span>Dossier complete</span>
                    <b>{researched.length}</b>
                  </div>
                  <div className="review-stat-chip neg">
                    <span>Excluded</span>
                    <b>{excluded.length}</b>
                  </div>
                  {researched.length > 0 && (
                    <p className="review-tickers">
                      {researched.map((r) => r.ticker).join(' · ')}
                    </p>
                  )}
                  {excluded.length > 0 && (
                    <p className="review-excluded">
                      Excluded from new contributions:{' '}
                      {excluded.map((c) => c.ticker).join(', ')}. See each
                      company&rsquo;s note in Holdings.
                    </p>
                  )}
                </div>
              </div>

              {shortlistTickers.length > 0 && (
                <div className="review-evidence-block">
                  <button
                    type="button"
                    className="review-evidence-toggle"
                    onClick={() => setEvidenceOpen((v) => !v)}
                  >
                    <ChevronDown
                      size={15}
                      style={{
                        transform: evidenceOpen
                          ? 'rotate(180deg)'
                          : 'rotate(0deg)',
                        transition: 'transform .2s ease',
                      }}
                    />
                    {evidenceOpen ? 'Hide' : 'Show'} research evidence
                  </button>
                  <AnimatePresence>
                    {evidenceOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        style={{ overflow: 'hidden' }}
                      >
                        <p className="muted" style={{ margin: '14px 0' }}>
                          Computed directly from saved dossiers and the
                          latest quote — no AI involved. Use it to
                          sanity-check the AI review.
                        </p>
                        <section className="panel table-panel review-evidence-table">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {[
                                  'Company',
                                  'Status',
                                  'Score',
                                  'Fair value (bear–bull)',
                                  'Price',
                                  'Valuation',
                                  'Updated',
                                ].map((x) => (
                                  <TableHead key={x}>{x}</TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {research.map((r) => (
                                <TableRow
                                  key={r.ticker}
                                  className={
                                    r.status === 'Complete'
                                      ? ''
                                      : 'row-attention'
                                  }
                                >
                                  <TableCell className="ticker">
                                    {r.ticker}
                                  </TableCell>
                                  <TableCell>
                                    <span
                                      className={`tag status-${r.status.toLowerCase().replace(' ', '-')}`}
                                    >
                                      {r.status}
                                    </span>
                                  </TableCell>
                                  <TableCell className="amount">
                                    {r.score === null ? '—' : `${r.score}/100`}
                                  </TableCell>
                                  <TableCell>
                                    {r.fairValueLow === null ||
                                    r.fairValueHigh === null
                                      ? '—'
                                      : `${money(r.fairValueLow)} – ${money(r.fairValueHigh)}`}
                                  </TableCell>
                                  <TableCell className="amount">
                                    {r.price === null ? '—' : money(r.price)}
                                  </TableCell>
                                  <TableCell
                                    className={
                                      r.valuationPct === null
                                        ? ''
                                        : r.valuationPct >= 0
                                          ? 'pos-text'
                                          : 'neg-text'
                                    }
                                  >
                                    {r.valuationPct === null
                                      ? '—'
                                      : `${r.valuationPct >= 0 ? 'Undervalued' : 'Overvalued'} ${Math.abs(r.valuationPct)}%`}
                                  </TableCell>
                                  <TableCell>{r.updatedAt || '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </section>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              <div className="review-nav">
                <span />
                <button onClick={() => setStep(1)}>
                  Continue to Generate
                  <ChevronRight size={16} />
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="review-panel">
              <p className="eyebrow">LOW-COST MODE · GPT-5 NANO</p>
              <h2>A useful second look. At a tiny cost.</h2>
              <p>
                Review concentration, current holdings, your {money(budget)}{' '}
                budget, quote dates, and the seven-company research
                shortlist. AI uses a compact summary and saved research to
                propose target weights. Calculations run without AI charges.
                Unchanged reviews are reused.
              </p>
              <div className="row">
                <button
                  disabled={reviewBusy || busy || !aiAvailable}
                  onClick={() => void aiReview()}
                >
                  {reviewBusy ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {reviewBusy ? 'Reviewing portfolio…' : 'Generate AI review'}
                </button>
                <button
                  className="secondary"
                  onClick={() => setPromptOpen(true)}
                >
                  Export to ChatGPT
                </button>
              </div>
              {!aiAvailable && (
                <p className="notice">
                  Built-in AI is awaiting a secure connection. The ChatGPT
                  handoff below works now.
                </p>
              )}
              {message && (
                <p
                  role="alert"
                  className={`notice ${failed ? 'error' : 'success'}`}
                >
                  {message}
                </p>
              )}
              <p className="muted">
                No paid web searches or automatic retries. This review uses
                saved research; it does not verify new filings or current
                Shariah status. No orders are placed.
              </p>

              <div className="review-import">
                <h2>Bring back a ChatGPT review</h2>
                <p>
                  Export the review prompt, use it in your research
                  conversation, then paste its JSON here. Review the
                  proposed changes before applying them.
                </p>
                <label>
                  AI review JSON
                  <textarea
                    rows={5}
                    value={aiText}
                    onChange={(e) => setAiText(e.target.value)}
                    placeholder={
                      '{"summary":"Reasoning with sources and research gaps…","weights":{"MEBL":15,…}}'
                    }
                  />
                </label>
                <button
                  className="secondary"
                  onClick={() => {
                    try {
                      setProposal(validateReview(JSON.parse(aiText), p));
                      notify(
                        'Review validated. Inspect the proposed weights below.',
                      );
                      setStep(2);
                    } catch (e) {
                      notify(String(e), true);
                    }
                  }}
                >
                  Validate & preview
                </button>
              </div>

              <div className="review-nav">
                <button className="secondary" onClick={() => setStep(0)}>
                  <ChevronLeft size={16} />
                  Back to Coverage
                </button>
                <span />
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="review-panel">
              {proposal ? (
                <>
                  <p className="eyebrow">PROPOSED TARGETS · NOT APPLIED</p>
                  <h2>Review the reasoning</h2>
                  <motion.p
                    className="review-reasoning"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                  >
                    {proposal.summary}
                  </motion.p>
                  <motion.div
                    className="review-delta-grid"
                    initial="hidden"
                    animate="show"
                    variants={{
                      show: { transition: { delayChildren: stagger(0.04) } },
                    }}
                  >
                    {Object.entries(proposal.weights).map(([t, w]) => {
                      const current =
                        p.companies.find((c) => c.ticker === t)?.target ?? 0;
                      const delta = round1(w - current);
                      return (
                        <motion.div
                          key={t}
                          className="review-delta-chip"
                          variants={{
                            hidden: { opacity: 0, y: 8 },
                            show: { opacity: 1, y: 0 },
                          }}
                        >
                          <span>{t}</span>
                          <div className="review-delta-values">
                            <b>{w}%</b>
                            {delta !== 0 && (
                              <small
                                className={delta > 0 ? 'pos-text' : 'neg-text'}
                              >
                                {delta > 0 ? (
                                  <ArrowUp size={11} />
                                ) : (
                                  <ArrowDown size={11} />
                                )}
                                {Math.abs(delta)}
                              </small>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </>
              ) : (
                <div className="review-empty">
                  <p>No pending review yet.</p>
                  <button className="secondary" onClick={() => setStep(1)}>
                    Go to Generate
                  </button>
                </div>
              )}
              <div className="review-nav">
                <button className="secondary" onClick={() => setStep(1)}>
                  <ChevronLeft size={16} />
                  Back to Generate
                </button>
                {proposal && (
                  <button onClick={() => setStep(3)}>
                    Continue to Apply
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="review-panel">
              <p className="eyebrow">APPLY · COMMIT TO PORTFOLIO</p>
              {proposal ? (
                <>
                  <h2>Apply the reviewed targets</h2>
                  <p>
                    This sets each shortlisted company&rsquo;s target weight
                    to the value above. Purchase eligibility remains your
                    decision in Holdings.
                  </p>
                  <button disabled={busy} onClick={() => void applyProposal()}>
                    <Check size={16} />
                    Apply reviewed targets
                  </button>
                  {message && (
                    <p
                      role="alert"
                      className={`notice ${failed ? 'error' : 'success'}`}
                    >
                      {message}
                    </p>
                  )}
                </>
              ) : (
                <p className="muted">
                  No pending proposal. Generate or import a review to apply
                  new targets.
                </p>
              )}
              {p.aiReview && (
                <div className="review-history">
                  <p className="eyebrow">LAST APPLIED AI REVIEW</p>
                  <small>{p.aiReview.generatedAt}</small>
                  <p style={{ whiteSpace: 'pre-wrap' }}>
                    {p.aiReview.summary}
                  </p>
                </div>
              )}
              <div className="review-nav">
                <button className="secondary" onClick={() => setStep(2)}>
                  <ChevronLeft size={16} />
                  Back to Review
                </button>
                <span />
              </div>
            </section>
          )}
        </motion.div>
      </AnimatePresence>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="form-dialog">
          <DialogTitle>Review in ChatGPT</DialogTitle>
          <DialogDescription>
            This contains your holdings and transactions. Copy it into your
            private research conversation.
          </DialogDescription>
          <textarea
            aria-label="Portfolio review prompt"
            readOnly
            rows={12}
            value={reviewPrompt(p, month, currentPlan)}
          />
          <div className="row">
            <button
              onClick={() => {
                navigator.clipboard
                  .writeText(reviewPrompt(p, month, currentPlan))
                  .then(() =>
                    notify(
                      'Review prompt copied. Paste it into your research conversation.',
                    ),
                  )
                  .catch((e) => notify(String(e), true));
              }}
            >
              Copy review prompt
            </button>
            <button
              className="secondary"
              onClick={() =>
                download(
                  `psx-ai-review-${today()}.txt`,
                  reviewPrompt(p, month, currentPlan),
                  'text/plain',
                )
              }
            >
              Download prompt
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
