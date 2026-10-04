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
    kind: 'ahl', type: 'PDF or JSON', accept: 'application/pdf,.pdf,application/json,.json',
    brings: 'Buys and sells from your Client Ledger.',
    how: 'Use the Client Ledger PDF from AHL (an older trade-history JSON also works). Deposits, withdrawals, interest, charges and tax entries are never imported.',
  },
  {
    kind: 'finqalab', type: 'PDF', accept: 'application/pdf,.pdf',
    brings: 'Buys and sells from your trade report.',
    how: 'Use the Periodic Trade Details Report PDF from Finqalab. Overlapping reports will not duplicate trades.',
  },
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
  busy, summary, onImportFile,
}: {
  busy: boolean;
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
          <strong>Drop a file here or choose one</strong>
          <span>AHL, Finqalab, CDC or IPO files. The app recognises which one it is and shows a full review before anything is saved.</span>
        </div>
        <button type="button" disabled={busy} onClick={() => pick.current?.click()}>Choose file</button>
        <input
          ref={pick}
          type="file"
          accept="application/pdf,.pdf,application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onImportFile(f);
          }}
        />
      </div>
      <p className="imp-note">
        Files are read on this device and never uploaded. Importing the same file twice changes nothing.
      </p>
      <div className="imp-grid">
        {SOURCES.map((s) => {
          const last = summary[s.kind];
          return (
            <article key={s.kind} className="imp-card">
              <header>
                <strong>{IMPORT_LABEL[s.kind]}</strong>
                <em>{s.type}</em>
              </header>
              <p>{s.brings}</p>
              <small>{last ? `${last.count} ${noun[s.kind]}${last.count === 1 ? '' : 's'} imported, latest ${fmtDate(last.latest)}` : 'Nothing imported yet'}</small>
              <details>
                <summary>How to get this file</summary>
                <p>{s.how}</p>
              </details>
              <UploadButton accept={s.accept} disabled={busy} onFile={(f) => onImportFile(f, s.kind)} />
            </article>
          );
        })}
      </div>
    </div>
  );
}
