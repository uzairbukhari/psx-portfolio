'use client';
import { useMemo, useState } from 'react';
import { Plus, ExternalLink, Save, Download, Upload } from 'lucide-react';
import { today, type Portfolio, type ResearchCompany } from '@/lib/portfolio';
import DossierExperience from './dossier-experience';
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
  const save = async (value = draft) => {
    if (!value) return;
    const next = structuredClone(portfolio);
    next.research = [
      ...(next.research ?? []).filter((r) => r.ticker !== value.ticker),
      { ...value, updatedAt: today() },
    ];
    await onSave(next, `${value.ticker} research dossier saved.`);
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
        details: c,
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
      <DossierExperience
        draft={draft}
        company={portfolio.companies.find((c) => c.ticker === draft.ticker)}
        onChange={setDraft}
        onBack={() => setSelected(null)}
        onSave={save}
        onExport={exportDossier}
      />
    );

  return (
    <section className="research-queue">
      <div className="section-top">
        <div>
          <p className="eyebrow">PSX RESEARCH DESK</p>
          <h2>Research queue & dossiers</h2>
          <p>Portfolio positions and research records now live together.</p>
        </div>
        <div className="row">
          <label className="import-label">
            <Upload size={15} /> Import research backup
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

