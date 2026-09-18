'use client';
import { useEffect, useState } from 'react';
import { Sparkles, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  money,
  today,
  reviewPrompt,
  researchInsights,
  validateReview,
  type Portfolio,
} from '@/lib/portfolio';

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
    [promptOpen, setPromptOpen] = useState(false);

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
    <div className="ai-review">
      <div className="ai-review-hero">
        <div className="panel ai-review-hero-copy">
          <p className="eyebrow">LOW-COST MODE · GPT-5 NANO</p>
          <h2>A useful second look. At a tiny cost.</h2>
          <p>
            Review concentration, current holdings, your {money(budget)}{' '}
            budget, quote dates, and the seven-company research shortlist.
            AI uses a compact summary and saved research to propose target
            weights. Calculations run without AI charges. Unchanged reviews
            are reused.
          </p>
          <div className="row">
            <button
              disabled={reviewBusy || busy || !aiAvailable}
              onClick={aiReview}
            >
              <Sparkles size={16} />
              {reviewBusy ? 'Reviewing portfolio…' : 'Generate AI review'}
            </button>
            <button className="secondary" onClick={() => setPromptOpen(true)}>
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
            <p role="alert" className={`notice ${failed ? 'error' : 'success'}`}>
              {message}
            </p>
          )}
          <p className="muted">
            No paid web searches or automatic retries. This review uses
            saved research; it does not verify new filings or current
            Shariah status. No orders are placed.
          </p>
        </div>
        <div className="ai-review-coverage">
          <p className="eyebrow">RESEARCH STATUS · LIVE</p>
          <div className="ai-review-ring" style={{ '--pct': coveragePercent } as React.CSSProperties}>
            <span>
              {researched.length}
              <small>/{shortlistTickers.length}</small>
            </span>
          </div>
          <p className="ai-review-ring-label">Shortlisted companies with a full dossier</p>
          {researched.length > 0 && (
            <p className="ai-review-tickers">
              {researched.map((r) => r.ticker).join(' · ')}
            </p>
          )}
          {excluded.length > 0 && (
            <p className="ai-review-excluded">
              Excluded from new contributions: {excluded.map((c) => c.ticker).join(', ')}.
              See each company&rsquo;s note in Holdings.
            </p>
          )}
        </div>
      </div>

      {shortlistTickers.length > 0 && (
        <section className="panel table-panel" style={{ marginTop: 22 }}>
          <h2 style={{ padding: '24px 24px 0' }}>Research evidence</h2>
          <p className="muted" style={{ padding: '0 24px' }}>
            Computed directly from saved dossiers and the latest quote —
            no AI involved. Use it to sanity-check the AI review below.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {[
                    'Company',
                    'Status',
                    'Score',
                    'Fair value (bear–bull)',
                    'Price',
                    'Valuation',
                    'Updated',
                  ].map((x) => (
                    <th key={x}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {research.map((r) => (
                  <tr key={r.ticker}>
                    <td>{r.ticker}</td>
                    <td>{r.status}</td>
                    <td>{r.score === null ? '—' : `${r.score}/100`}</td>
                    <td>
                      {r.fairValueLow === null || r.fairValueHigh === null
                        ? '—'
                        : `${money(r.fairValueLow)} – ${money(r.fairValueHigh)}`}
                    </td>
                    <td>{r.price === null ? '—' : money(r.price)}</td>
                    <td className={
                      r.valuationPct === null
                        ? ''
                        : r.valuationPct >= 0
                          ? 'pos-text'
                          : 'neg-text'
                    }>
                      {r.valuationPct === null
                        ? '—'
                        : `${r.valuationPct >= 0 ? 'Undervalued' : 'Overvalued'} ${Math.abs(r.valuationPct)}%`}
                    </td>
                    <td>{r.updatedAt || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel" style={{ marginTop: 22 }}>
        <h2>Bring back a ChatGPT review</h2>
        <p>
          Export the review prompt, use it in your research conversation,
          then paste its JSON here. Review the proposed changes before
          applying them.
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
              notify('Review validated. Inspect the proposed weights below.');
            } catch (e) {
              notify(String(e), true);
            }
          }}
        >
          Validate & preview
        </button>
      </section>

      {proposal && (
        <section className="panel" style={{ marginTop: 22 }}>
          <p className="eyebrow">PROPOSED TARGETS · NOT APPLIED</p>
          <h2>Review the reasoning</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{proposal.summary}</p>
          <div className="delta-grid">
            {Object.entries(proposal.weights).map(([t, w]) => {
              const current = p.companies.find((c) => c.ticker === t)?.target ?? 0;
              const delta = round1(w - current);
              return (
                <div key={t} className="delta-chip">
                  <span>{t}</span>
                  <div className="delta-chip-values">
                    <b>{w}%</b>
                    {delta !== 0 && (
                      <small className={delta > 0 ? 'pos-text' : 'neg-text'}>
                        {delta > 0 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                        {Math.abs(delta)}
                      </small>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <button disabled={busy} onClick={() => void applyProposal()}>
            Apply reviewed targets
          </button>
        </section>
      )}

      {p.aiReview && (
        <section className="panel" style={{ marginTop: 22 }}>
          <h2>Last applied AI review</h2>
          <small>{p.aiReview.generatedAt}</small>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.aiReview.summary}</p>
        </section>
      )}

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
            value={reviewPrompt(p, month)}
          />
          <div className="row">
            <button
              onClick={() => {
                navigator.clipboard
                  .writeText(reviewPrompt(p, month))
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
                  reviewPrompt(p, month),
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
