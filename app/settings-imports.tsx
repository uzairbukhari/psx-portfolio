'use client';

import { useRef, useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { IMPORT_LABEL, type ImportKind, type ImportSummary } from '@/lib/import-detect';

export function UploadButton({
  accept, onFile, disabled, label = 'Choose file',
}: {
  accept: string;
  onFile: (file: File) => void;
  disabled: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="secondary compact" disabled={disabled} onClick={() => input.current?.click()}>
        <Upload size={14} /> {label}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </>
  );
}

const SOURCES: { kind: ImportKind; type: string; accept: string; brings: string; how: string }[] = [
  {
    kind: 'cdc', type: 'JSON', accept: 'application/json,.json',
    brings: 'Dividends CDC has paid you.',
    how: 'Use the CDC Access dividend export. Only Paid rows are imported; bank and personal fields are never read.',
  },
  {
    kind: 'ipo', type: 'JSON', accept: 'application/json,.json',
    brings: 'IPO shares you were allotted, net of refunds.',
    how: 'Use your IPO subscription list export. Only allotted shares are added, at the amount you paid after any refund; rows that were not allotted are listed and skipped.',
  },
];

const noun: Record<ImportKind, string> = { ahl: 'trade', finqalab: 'trade', ipo: 'allotment', cdc: 'dividend' };
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function ImportPanel({
  busy, summary, onImportFile, isAdmin,
}: {
  busy: boolean;
  isAdmin: boolean;
  summary: ImportSummary;
  onImportFile: (file: File, expected?: ImportKind) => void;
}) {
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  return (
    <div className="imp">
      <div
        className={`imp-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f && !busy) onImportFile(f);
        }}
      >
        <FileUp size={22} aria-hidden />
        <div>
          <strong>Import broker statement</strong>
          <span>Drop your statement here or choose a file. The app detects supported statement formats automatically.</span>
        </div>
        <button type="button" disabled={busy} onClick={() => pick.current?.click()}>Import statement</button>
        <input
          ref={pick}
          type="file"
          accept="application/pdf,.pdf,application/json,.json,text/csv,.csv,.xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onImportFile(f);
          }}
        />
      </div>
      <p className="imp-note">
        Choose a PDF, CSV, Excel (.xlsx), or JSON statement. Known AHL and Finqalab formats are read on your device without AI. Other formats may use the app’s AI service after you approve sharing the statement text.
      </p>
      <p className="imp-note">Importing the same statement again will not duplicate your trades.</p>
      {isAdmin && <>
      <h3 className="set-group-title">Additional imports · Super admin</h3>
      <div className="imp-grid">
        {SOURCES.map((s) => {
          const last = summary[s.kind];
          return (
            <article key={s.kind} className="imp-card">
              <div className="imp-card-head">
                <strong>{IMPORT_LABEL[s.kind]}</strong>
                <em>{s.type}</em>
              </div>
              <p>{s.brings}</p>
              <small>{last ? `${last.count} ${noun[s.kind]}${last.count === 1 ? '' : 's'} imported, latest ${fmtDate(last.latest)}` : 'Nothing imported yet'}</small>
              <details>
                <summary>How to get this file</summary>
                <p>{s.how}</p>
              </details>
              <UploadButton label={s.kind === 'ipo' ? 'Import IPO' : 'Import dividends'} accept={s.accept} disabled={busy} onFile={(f) => onImportFile(f, s.kind)} />
            </article>
          );
        })}
      </div>
      </>}
    </div>
  );
}
