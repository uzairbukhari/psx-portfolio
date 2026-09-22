'use client';
import { useState } from 'react';
import { ArrowLeft, ExternalLink, Plus, Save } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import {
  Company,
  Financial,
  rubric,
  statuses,
  score,
  money,
  safeUrl,
} from './research-data';
import {
  scenarioValue,
  upsideDownsidePct,
  discountToValuePct,
} from '@/lib/valuation';
export function Choice({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Dossier({
  company,
  onSave,
  onBack,
}: {
  company: Company;
  onSave: (c: Company, message: string) => Promise<void>;
  onBack: () => void;
}) {
  const [c, setC] = useState<Company>(() => structuredClone(company));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [error, setError] = useState('');
  const [metric, setMetric] = useState('eps');
  const update = (patch: Partial<Company>) => {
    setC((v) => ({ ...v, ...patch }));
    setDirty(true);
  };
  const num = (s: string) => (s === '' ? null : Number(s));
  const save = async () => {
    if (c.conversation && !safeUrl(c.conversation)) {
      setError('Use a full http or https conversation link.');
      return;
    }
    setSaving(true);
    try {
      await onSave(
        c,
        'Dossier updated: financials, assumptions, scorecard or research notes',
      );
      setDirty(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dossier was not saved.');
    } finally {
      setSaving(false);
    }
  };
  const latest = c.financials.slice().sort((a, b) => b.year - a.year)[0];
  const activeRubric = c.scoreRubric?.length
    ? c.scoreRubric.map((item) => [item.name, item.max] as const)
    : rubric;
  return (
    <>
      <button
        className="back"
        onClick={() => {
          if (
            !dirty ||
            window.confirm('Leave without saving your dossier changes?')
          )
            onBack();
        }}
      >
        <ArrowLeft size={16} /> All companies
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {c.sector.toUpperCase()} / COMPANY DOSSIER
          </div>
          <h1>
            {c.name} <span className="ticker-heading">{c.ticker}</span>
          </h1>
          <p>
            {c.demo
              ? 'Illustrative dossier · replace demo data before using for investment research'
              : 'Your research dossier · verify figures against source documents'}
          </p>
        </div>
        <button
          className="primary"
          disabled={saving}
          onClick={() => void save()}
        >
          <Save size={16} />
          {dirty ? 'Save changes' : 'Save dossier'}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dossier-controls">
        <div className="control-label">
          Research status
          <Choice
            value={c.status}
            options={statuses}
            onChange={(status) => update({ status })}
            label="Research status"
          />
        </div>
        <label>
          Research week
          <input
            type="date"
            value={c.week}
            onChange={(e) => update({ week: e.target.value })}
          />
        </label>
        <label>
          Reference price · PKR
          <input
            type="number"
            min="0"
            step="any"
            value={c.price ?? ''}
            onChange={(e) =>
              update({
                price:
                  e.target.value === ''
                    ? null
                    : Math.max(0, Number(e.target.value)),
              })
            }
          />
        </label>
        <label>
          Price as of
          <input
            type="date"
            value={c.priceDate}
            onChange={(e) => update({ priceDate: e.target.value })}
          />
        </label>
      </div>
      <div className="stats compact">
        {[
          [
            'Quality score',
            score(c) === null ? '—' : score(c) + '/100',
            c.schemaVersion === 2
              ? 'Complete all seven categories'
              : 'Complete all five categories',
          ],
          ['Latest EPS', money(latest?.eps), 'PKR per share'],
          [
            'Reference P/E',
            c.price != null && latest?.eps && latest.eps > 0
              ? money(c.price / latest.eps) + '×'
              : '—',
            'Positive earnings only',
          ],
          [
            'Dividend yield',
            c.price && latest?.dividend != null
              ? money((latest.dividend / c.price) * 100) + '%'
              : '—',
            'Latest annual DPS ÷ price',
          ],
        ].map(([a, b, d]) => (
          <div className="stat" key={a}>
            <span>{a}</span>
            <strong>{b}</strong>
            <small>{d}</small>
          </div>
        ))}
      </div>
      <Tabs defaultValue="research">
        <TabsList variant="line" className="dossier-tabs">
          {[
            ['research', 'Research notes'],
            ['financials', 'Financials'],
            ['valuation', 'Valuation'],
            ['score', 'Scorecard'],
            ['sources', 'Documents'],
            ['history', 'Update history'],
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="research">
          {c.researchNarrative && (
            <section className="panel padded research-narrative">
              <div className="section-heading">
                <div>
                  <h2>Research findings</h2>
                  <p className="help">
                    Confidence: {c.confidence || 'Not stated'}
                  </p>
                </div>
              </div>
              <p>{c.researchNarrative}</p>
              {!!c.missingInformation?.length && (
                <>
                  <h3>Missing information</h3>
                  <ul>
                    {c.missingInformation.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {c.investmentStance && (
                <div className="notice">
                  <h3>Investment stance: {c.investmentStance}</h3>
                  <p>{c.decisionSummary}</p>
                </div>
              )}
            </section>
          )}
          <div className="note-grid">
            {[
              [
                'thesis',
                'Investment thesis',
                'What must be true for this business to compound value?',
              ],
              [
                'risk',
                'Risks & disconfirming evidence',
                'What would change your mind? Include thresholds to watch.',
              ],
              [
                'catalyst',
                'Catalysts & next checks',
                'What could change, when, and what evidence will you monitor?',
              ],
            ].map(([k, title, hint]) => (
              <section className="panel padded" key={k}>
                <h2>{title}</h2>
                <p className="help">{hint}</p>
                <textarea
                  aria-label={title}
                  value={c[k as 'thesis']}
                  onChange={(e) => update({ [k]: e.target.value })}
                  placeholder="Add your research…"
                />
              </section>
            ))}
          </div>
          <section className="panel padded mt">
            <h2>Company conversation</h2>
            <p className="help">
              Keep one conversation named “{c.ticker} — {c.name}” in your PSX
              Research project. Paste its URL to connect your notes.
            </p>
            <div className="inline-form">
              <input
                aria-label="ChatGPT conversation URL"
                type="url"
                value={c.conversation}
                placeholder="https://chatgpt.com/c/…"
                onChange={(e) => update({ conversation: e.target.value })}
              />
              {safeUrl(c.conversation) && (
                <a
                  className="secondary"
                  href={c.conversation}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open chat <ExternalLink size={14} />
                </a>
              )}
            </div>
          </section>
        </TabsContent>
        <TabsContent value="financials">
          <section className="panel padded">
            <div className="section-heading">
              <div>
                <h2>Five-year financial view</h2>
                <p className="help">
                  Annual figures · PKR million, except EPS and dividend per
                  share
                </p>
              </div>
              <Choice
                value={metric}
                options={['eps', 'revenue', 'profit', 'ocf']}
                onChange={setMetric}
                label="Chart metric"
              />
            </div>
            {c.financials.length ? (
              <FinancialChart rows={c.financials} metric={metric} />
            ) : (
              <p className="empty">
                Add an annual period to begin your financial history.
              </p>
            )}
            {c.sector === 'Banking' && (
              <p className="help">
                Banking: use total income consistently for revenue. Industrial
                operating cash flow and debt comparisons are not applicable;
                leave them blank and record bank-specific ratios in your notes.
              </p>
            )}
          </section>
          <div className="section-heading mt">
            <h2>Reported financials</h2>
            <button
              className="secondary"
              onClick={() => {
                const year = c.financials.length
                  ? Math.max(...c.financials.map((x) => x.year)) + 1
                  : new Date().getFullYear() - 1;
                update({
                  financials: [
                    ...c.financials,
                    {
                      year,
                      revenue: null,
                      profit: null,
                      eps: null,
                      ocf: null,
                      debt: null,
                      equity: null,
                      dividend: null,
                      source: '',
                      page: '',
                      basis: 'Standalone',
                      verified: false,
                    },
                  ],
                });
              }}
            >
              <Plus size={16} /> Add year
            </button>
          </div>
          <div className="panel financial-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>YEAR</TableHead>
                  {[
                    'Revenue',
                    'PAT',
                    'EPS',
                    'OCF',
                    'Debt',
                    'Equity',
                    'DPS',
                  ].map((v) => (
                    <TableHead key={v}>{v}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.financials.map((f, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <input
                        aria-label={'Year ' + (i + 1)}
                        type="number"
                        value={f.year}
                        onChange={(e) =>
                          update({
                            financials: c.financials.map((r, j) =>
                              j === i
                                ? { ...r, year: Number(e.target.value) }
                                : r,
                            ),
                          })
                        }
                      />
                    </TableCell>
                    {(
                      [
                        'revenue',
                        'profit',
                        'eps',
                        'ocf',
                        'debt',
                        'equity',
                        'dividend',
                      ] as const
                    ).map((k) => (
                      <TableCell key={k}>
                        <input
                          type="number"
                          step="any"
                          aria-label={`${f.year} ${k}`}
                          value={f[k] ?? ''}
                          placeholder="—"
                          onChange={(e) =>
                            update({
                              financials: c.financials.map((r, j) =>
                                j === i
                                  ? {
                                      ...r,
                                      [k]: num(e.target.value),
                                      verified: false,
                                    }
                                  : r,
                              ),
                            })
                          }
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {c.financials.map((f, i) => (
            <div className="source-row" key={i}>
              <b>{f.year} source</b>
              <input
                aria-label={`${f.year} source`}
                value={f.source}
                placeholder="Report title or URL"
                onChange={(e) =>
                  update({
                    financials: c.financials.map((r, j) =>
                      j === i
                        ? { ...r, source: e.target.value, verified: false }
                        : r,
                    ),
                  })
                }
              />
              <input
                aria-label={`${f.year} page`}
                value={f.page}
                placeholder="Page"
                onChange={(e) =>
                  update({
                    financials: c.financials.map((r, j) =>
                      j === i ? { ...r, page: e.target.value } : r,
                    ),
                  })
                }
              />
              <Choice
                label={`${f.year} basis`}
                value={f.basis}
                options={['Standalone', 'Consolidated', 'Demo / standalone']}
                onChange={(basis) =>
                  update({
                    financials: c.financials.map((r, j) =>
                      j === i ? { ...r, basis } : r,
                    ),
                  })
                }
              />
              <span className="subtle">
                {f.verified ? 'Verified' : 'Unverified'}
              </span>
            </div>
          ))}
        </TabsContent>
        <TabsContent value="valuation">
          <section className="panel padded">
            <h2>What is the business worth?</h2>
            <p className="help">
              An earnings-multiple sensitivity model. Fair value = normalized
              EPS × assumed P/E. This is an assumption-based estimate, not a
              price forecast. Use positive normalized earnings; negative EPS
              requires another valuation method.
            </p>
            <div className="scenario-grid">
              {c.scenarios.map((s, i) => {
                const result = scenarioValue(s);
                const fair = result.value;
                const isBase = s.name.trim().toLowerCase() === 'base';
                return (
                  <div
                    className={'scenario ' + (isBase ? 'base' : '')}
                    key={s.name}
                  >
                    <span className="eyebrow">{s.name.toUpperCase()} CASE</span>
                    <label>
                      Normalized EPS · PKR
                      <input
                        type="number"
                        step="any"
                        value={s.eps ?? ''}
                        onChange={(e) =>
                          update({
                            scenarios: c.scenarios.map((v, j) =>
                              j === i ? { ...v, eps: num(e.target.value) } : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Assumed P/E · times
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={s.multiple ?? ''}
                        onChange={(e) =>
                          update({
                            scenarios: c.scenarios.map((v, j) =>
                              j === i
                                ? { ...v, multiple: num(e.target.value) }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <p className="help">Implied fair value · PKR</p>
                    <strong>
                      {fair === null ? (
                        <span
                          className="unavailable"
                          title={result.reason ?? undefined}
                        >
                          Unavailable
                        </span>
                      ) : (
                        money(fair)
                      )}
                    </strong>
                    <div
                      className={
                        fair && c.price && fair >= c.price ? 'green' : 'subtle'
                      }
                    >
                      {fair && c.price
                        ? money(upsideDownsidePct(fair, c.price)) +
                          '% vs reference price'
                        : 'Add positive EPS, P/E and price'}
                    </div>
                  </div>
                );
              })}
            </div>
            {(() => {
              const baseScenario = c.scenarios.find(
                (s) => s.name.trim().toLowerCase() === 'base',
              );
              const baseResult = scenarioValue(
                baseScenario ?? { name: 'Base', eps: null, multiple: null },
              );
              const upside = upsideDownsidePct(baseResult.value, c.price);
              const discount = discountToValuePct(baseResult.value, c.price);
              if (upside === null || discount === null) return null;
              return (
                <p className="valuation-summary">
                  {upside >= 0
                    ? `Undervalued ${upside}%`
                    : `Overvalued ${Math.abs(upside)}%`}{' '}
                  vs. base-case value
                  {' · '}
                  {discount >= 0
                    ? `${discount}% discount to base-case value`
                    : `${Math.abs(discount)}% premium to base-case value`}
                </p>
              );
            })()}
            {c.valuationNotes && (
              <div className="research-narrative mt">
                <h3>Valuation reasoning and assumptions</h3>
                <p>{c.valuationNotes}</p>
              </div>
            )}
          </section>
        </TabsContent>
        <TabsContent value="score">
          <section className="panel padded">
            <div className="section-heading">
              <div>
                <h2>Evidence before conviction</h2>
                <p className="help">
                  A 100-point framework. Scores are analyst judgments, not
                  automatic buy signals. Leave unknown categories blank.
                </p>
              </div>
              <strong className="total-score">
                {score(c) ?? '—'}
                <small>/100</small>
              </strong>
            </div>
            {activeRubric.map(([name, max], i) => (
              <div className="score-row" key={name}>
                <div>
                  <h3>{name}</h3>
                  <p className="help">Maximum {max} points</p>
                  <Progress value={((c.scores[i] ?? 0) / max) * 100} />
                </div>
                <input
                  aria-label={name + ' score'}
                  type="number"
                  min="0"
                  max={max}
                  value={c.scores[i] ?? ''}
                  onChange={(e) =>
                    update({
                      scores: c.scores.map((n, j) =>
                        j === i
                          ? e.target.value === ''
                            ? null
                            : Math.max(0, Math.min(max, Number(e.target.value)))
                          : n,
                      ),
                    })
                  }
                />
                <textarea
                  aria-label={name + ' evidence'}
                  placeholder="Evidence and reasoning for this score…"
                  value={c.scoreNotes[i]}
                  onChange={(e) =>
                    update({
                      scoreNotes: c.scoreNotes.map((n, j) =>
                        j === i ? e.target.value : n,
                      ),
                    })
                  }
                />
              </div>
            ))}
          </section>
        </TabsContent>
        <TabsContent value="sources">
          <section className="panel padded">
            <h2>Source documents</h2>
            <p className="help">
              Official annual reports, PSX filings and announcements used by
              this dossier. Original downloaded files are retained in the
              company folder on your Mac.
            </p>
            <div className="inline-form">
              <input
                aria-label="Document title"
                placeholder="Document title"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
              />
              <input
                aria-label="Document URL"
                type="url"
                placeholder="https://…"
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
              />
              <button
                className="primary"
                onClick={() => {
                  if (!docTitle.trim() || !safeUrl(docUrl)) {
                    setError(
                      'Enter a document title and valid http or https URL.',
                    );
                    return;
                  }
                  update({
                    documents: [
                      ...c.documents,
                      {
                        title: docTitle.trim(),
                        url: docUrl,
                        kind: 'Report / filing',
                        date: new Date().toISOString(),
                      },
                    ],
                  });
                  setDocTitle('');
                  setDocUrl('');
                  setError('');
                }}
              >
                Add link
              </button>
            </div>
            {c.documents.length === 0 ? (
              <p className="empty">
                No documents linked yet. Start with the latest annual report.
              </p>
            ) : (
              c.documents.map((d, i) => (
                <div className="document-row" key={i}>
                  <div>
                    <b>{d.title}</b>
                    <small>
                      {d.kind} · {d.date.slice(0, 10)}
                    </small>
                  </div>
                  {safeUrl(d.url) && (
                    <a
                      className="secondary"
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open <ExternalLink size={14} />
                    </a>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      update({
                        documents: c.documents.filter((_, j) => i !== j),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </section>
        </TabsContent>
        <TabsContent value="history">
          <section className="panel padded">
            <h2>Research update history</h2>
            <p className="help">
              Dated saves preserve a record of your research activity.
            </p>
            {company.history
              .slice()
              .reverse()
              .map((h, i) => (
                <div className="history-row" key={i}>
                  <span className="dot" />
                  <div>
                    <small>{new Date(h.date).toLocaleString()}</small>
                    <p>{h.text}</p>
                  </div>
                </div>
              ))}
          </section>
        </TabsContent>
      </Tabs>
      <p className="save-hint">
        {dirty
          ? 'Unsaved changes — save your dossier before leaving.'
          : 'Changes are saved when you select Save dossier.'}
      </p>
    </>
  );
}
function FinancialChart({
  rows,
  metric,
}: {
  rows: Financial[];
  metric: string;
}) {
  const data = rows.slice().sort((a, b) => a.year - b.year);
  const values = data.map((f) => f[metric as 'eps']);
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1);
  return (
    <figure
      className="bar-chart"
      aria-label={`${metric.toUpperCase()} by financial year. Exact values appear above each bar.`}
    >
      {data.map((f, i) => (
        <div className="chart-col" key={i}>
          <span>{money(values[i])}</span>
          <div className="bar-track">
            <div
              style={{
                height:
                  values[i] === null
                    ? 0
                    : Math.max(3, (Math.abs(values[i]!) / max) * 100) + '%',
                background: (values[i] ?? 0) < 0 ? '#b96653' : undefined,
              }}
            />
          </div>
          <small>{f.year}</small>
        </div>
      ))}
    </figure>
  );
}
