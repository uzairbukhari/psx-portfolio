'use client';
import { useMemo, useState } from 'react';
import { Plus, ExternalLink, Save, Download, Upload } from 'lucide-react';
import {
  money,
  today,
  type Portfolio,
  type ResearchCompany,
} from '@/lib/portfolio';

type Props = {
  portfolio: Portfolio;
  onSave: (next: Portfolio, message?: string) => Promise<void>;
};
const blank = (ticker: string): ResearchCompany => ({
  ticker,
  status: 'Queue',
  score: null,
  fairValue: null,
  thesis: '',
  risks: '',
  catalysts: '',
  conversationUrl: '',
  sources: [],
  financials: [],
  updatedAt: today(),
});
export default function ResearchDesk({ portfolio, onSave }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResearchCompany | null>(null);
  const research = portfolio.research ?? [];
  const rows = useMemo(
    () =>
      research.map((r) => ({
        r,
        company: portfolio.companies.find((c) => c.ticker === r.ticker),
      })),
    [research, portfolio.companies],
  );
  const open = (ticker: string) => {
    const r = research.find((x) => x.ticker === ticker) ?? blank(ticker);
    setSelected(ticker);
    setDraft(structuredClone(r));
  };
  const save = async () => {
    if (!draft) return;
    const next = structuredClone(portfolio);
    next.research = [
      ...(next.research ?? []).filter((r) => r.ticker !== draft.ticker),
      { ...draft, updatedAt: today() },
    ];
    await onSave(next, `${draft.ticker} research dossier saved.`);
    setSelected(null);
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
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.ticker}-research-dossier.json`;
    a.click();
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
      .map((c) => ({
        ticker: String(c.ticker ?? '').toUpperCase(),
        status: ['Queue', 'Researching', 'Complete', 'Update needed'].includes(
          String(c.status),
        )
          ? (String(c.status) as ResearchCompany['status'])
          : 'Queue',
        score:
          typeof c.scores === 'object' && c.scores
            ? Object.values(c.scores as Record<string, unknown>).reduce<number>(
                (sum, n) => sum + (typeof n === 'number' ? n : 0),
                0,
              )
            : null,
        fairValue: null,
        thesis: String(c.thesis ?? ''),
        risks: String(c.risk ?? ''),
        catalysts: String(c.catalyst ?? ''),
        conversationUrl: String(c.conversation ?? ''),
        sources: Array.isArray(c.documents)
          ? c.documents
              .map((d) =>
                typeof d === 'object' && d
                  ? String((d as Record<string, unknown>).url ?? '')
                  : '',
              )
              .filter(Boolean)
          : [],
        financials: Array.isArray(c.financials)
          ? c.financials.map((f) => {
              const x = f as Record<string, unknown>;
              return {
                year: String(x.year ?? ''),
                revenue: typeof x.revenue === 'number' ? x.revenue : null,
                profit: typeof x.profit === 'number' ? x.profit : null,
                eps: typeof x.eps === 'number' ? x.eps : null,
                roe: null,
                debt: typeof x.debt === 'number' ? x.debt : null,
              };
            })
          : [],
        updatedAt: String(c.week ?? today()),
      }))
      .filter((r) => /^[A-Z0-9]{2,12}$/.test(r.ticker));
    for (const c of data.companies) {
      const ticker = String(c.ticker ?? '').toUpperCase();
      if (
        /^[A-Z0-9]{2,12}$/.test(ticker) &&
        !next.companies.some((x) => x.ticker === ticker)
      )
        next.companies.push({
          ticker,
          name: String(c.name ?? ticker),
          target: 0,
          approved: false,
          screenDate: '',
          note: 'Added from PSX Research Desk backup.',
        });
    }
    next.research = [
      ...(next.research ?? []).filter(
        (r) => !imported.some((i) => i.ticker === r.ticker),
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
      <section className="research-detail">
        <div className="section-top">
          <div>
            <p className="eyebrow">RESEARCH DOSSIER</p>
            <h2>
              {draft.ticker} —{' '}
              {portfolio.companies.find((c) => c.ticker === draft.ticker)
                ?.name ?? 'Company'}
            </h2>
          </div>
          <div className="row">
            <button className="secondary" onClick={() => setSelected(null)}>
              Back to queue
            </button>
            <button onClick={() => void save()}>
              <Save size={16} /> Save dossier
            </button>
          </div>
        </div>
        <div className="research-grid">
          <section className="panel">
            <label>
              Research status
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as ResearchCompany['status'],
                  })
                }
              >
                {['Queue', 'Researching', 'Complete', 'Update needed'].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Quality score (0–100)
              <input
                type="number"
                min="0"
                max="100"
                value={draft.score ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    score:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Fair value (PKR/share)
              <input
                type="number"
                min="0"
                value={draft.fairValue ?? ''}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fairValue:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Company conversation URL
              <input
                type="url"
                placeholder="https://chatgpt.com/..."
                value={draft.conversationUrl}
                onChange={(e) =>
                  setDraft({ ...draft, conversationUrl: e.target.value })
                }
              />
            </label>
            {draft.conversationUrl && (
              <a target="_blank" rel="noreferrer" href={draft.conversationUrl}>
                Open company conversation <ExternalLink size={14} />
              </a>
            )}
          </section>
          <section className="panel">
            <p className="eyebrow">WORKFLOW</p>
            <h2>One company, one continuing conversation</h2>
            <p>
              Create or reuse a chat named{' '}
              <b>
                {draft.ticker} —{' '}
                {
                  portfolio.companies.find((c) => c.ticker === draft.ticker)
                    ?.name
                }
              </b>
              . Put your verified figures, source links and judgement here; then
              save the structured record in this dossier.
            </p>
            <button className="secondary" onClick={exportDossier}>
              <Download size={16} /> Export company JSON
            </button>
          </section>
        </div>
        <section className="panel">
          <h2>Investment view</h2>
          <div className="form-grid">
            <label className="wide">
              Thesis
              <textarea
                rows={4}
                placeholder="Why could this business create value?"
                value={draft.thesis}
                onChange={(e) => setDraft({ ...draft, thesis: e.target.value })}
              />
            </label>
            <label>
              Key risks
              <textarea
                rows={4}
                placeholder="What could invalidate the thesis?"
                value={draft.risks}
                onChange={(e) => setDraft({ ...draft, risks: e.target.value })}
              />
            </label>
            <label>
              Catalysts / watch items
              <textarea
                rows={4}
                placeholder="What events or evidence should change the view?"
                value={draft.catalysts}
                onChange={(e) =>
                  setDraft({ ...draft, catalysts: e.target.value })
                }
              />
            </label>
          </div>
        </section>
        <section className="panel">
          <h2>Document links</h2>
          <p>
            One verified source URL per line: annual reports, results,
            presentations or official disclosures.
          </p>
          <textarea
            rows={4}
            placeholder="https://..."
            value={draft.sources.join('\n')}
            onChange={(e) =>
              setDraft({
                ...draft,
                sources: e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
          {draft.sources.length > 0 && (
            <div className="source-links">
              {draft.sources.map((source) => (
                <a key={source} href={source} target="_blank" rel="noreferrer">
                  Open source <ExternalLink size={13} />
                </a>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Annual financial evidence</h2>
          <p>
            Amounts in PKR millions; EPS in PKR/share. Add figures only after
            checking period, units, currency and consolidation basis.
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Revenue</th>
                  <th>Profit</th>
                  <th>EPS</th>
                  <th>ROE %</th>
                  <th>Debt</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.financials.map((f, i) => (
                  <tr key={i}>
                    {(
                      [
                        'year',
                        'revenue',
                        'profit',
                        'eps',
                        'roe',
                        'debt',
                      ] as const
                    ).map((k) => (
                      <td key={k}>
                        <input
                          value={f[k] ?? ''}
                          onChange={(e) => {
                            const fs = structuredClone(draft.financials);
                            fs[i] = {
                              ...fs[i],
                              [k]:
                                k === 'year'
                                  ? e.target.value
                                  : e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                            };
                            setDraft({ ...draft, financials: fs });
                          }}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="secondary compact"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            financials: draft.financials.filter(
                              (_, n) => n !== i,
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="secondary"
            onClick={() =>
              setDraft({
                ...draft,
                financials: [
                  ...draft.financials,
                  {
                    year: '',
                    revenue: null,
                    profit: null,
                    eps: null,
                    roe: null,
                    debt: null,
                  },
                ],
              })
            }
          >
            <Plus size={16} /> Add year
          </button>
        </section>
      </section>
    );
  return (
    <section>
      <div className="section-top">
        <div>
          <p className="eyebrow">PSX RESEARCH DESK</p>
          <h2>Research queue & dossiers</h2>
          <p>Portfolio positions and research records now live together.</p>
        </div>
        <div className="row">
          <label className="import-label">
            <Upload size={15} /> Import former Research Desk backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f)
                  void importLegacy(f).catch((err) =>
                    alert(err instanceof Error ? err.message : String(err)),
                  );
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button
            onClick={() => {
              const next = portfolio.companies.find(
                (c) => !research.some((r) => r.ticker === c.ticker),
              );
              if (next) open(next.ticker);
            }}
          >
            <Plus size={16} /> Add dossier
          </button>
        </div>
      </div>
      <section className="metrics research-metrics">
        <article>
          <span>Researching</span>
          <strong>
            {research.filter((r) => r.status === 'Researching').length}
          </strong>
        </article>
        <article>
          <span>Complete</span>
          <strong>
            {research.filter((r) => r.status === 'Complete').length}
          </strong>
        </article>
        <article>
          <span>Needs update</span>
          <strong>
            {research.filter((r) => r.status === 'Update needed').length}
          </strong>
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
                <th>Fair value</th>
                <th>Thesis</th>
                <th>Last saved</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, company }) => (
                <tr key={r.ticker}>
                  <td>
                    <span className="ticker">{r.ticker}</span>
                    <small>{company?.name}</small>
                  </td>
                  <td>
                    <span className="tag">{r.status}</span>
                  </td>
                  <td>{r.score ?? '—'}</td>
                  <td>{r.fairValue === null ? '—' : money(r.fairValue)}</td>
                  <td>
                    <small>{r.thesis || 'Not written yet'}</small>
                  </td>
                  <td>{r.updatedAt || '—'}</td>
                  <td>
                    <button
                      className="secondary compact"
                      onClick={() => open(r.ticker)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
