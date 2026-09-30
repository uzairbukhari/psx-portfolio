'use client';
import { useRef } from 'react';
import { FileText, Upload } from 'lucide-react';
import { useImports } from './hooks/use-imports';
import { usePortfolioContext } from './portfolio-context';

export type ImportKind = 'cdc' | 'finqalab' | 'ahl';

export const IMPORT_OPTIONS: {
  kind: ImportKind;
  label: string;
  hint: string;
  accept: string;
}[] = [
  { kind: 'cdc', label: 'Import CDC statement', hint: 'Dividends, JSON', accept: 'application/json,.json' },
  { kind: 'finqalab', label: 'Import Finqalab report', hint: 'Trades, PDF', accept: 'application/pdf,.pdf' },
  { kind: 'ahl', label: 'Import AHL history', hint: 'Trades, JSON', accept: 'application/json,.json' },
];

/** Hook returning a function that opens the right file picker and runs the matching import. */
export function useImportPicker() {
  const { busy } = usePortfolioContext();
  const { importCdc, importFinqalab, importAhl } = useImports();
  const input = useRef<HTMLInputElement>(null);
  const kind = useRef<ImportKind>('cdc');

  function pick(next: ImportKind) {
    if (busy || !input.current) return;
    kind.current = next;
    input.current.accept =
      IMPORT_OPTIONS.find((o) => o.kind === next)?.accept ?? '';
    input.current.click();
  }
  const element = (
    <input
      ref={input}
      type="file"
      hidden
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (kind.current === 'cdc') importCdc(file);
        else if (kind.current === 'finqalab') importFinqalab(file);
        else importAhl(file);
      }}
    />
  );
  return { pick, element };
}

/** Buttons for the existing imports, shown beside manual entry where the user starts out. */
export function ImportButtons({ kinds }: { kinds?: ImportKind[] }) {
  const { busy } = usePortfolioContext();
  const { pick, element } = useImportPicker();
  return (
    <>
      {IMPORT_OPTIONS.filter((o) => !kinds || kinds.includes(o.kind)).map((o) => (
        <button
          key={o.kind}
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => pick(o.kind)}
        >
          {o.kind === 'finqalab' ? <FileText size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {o.label}
        </button>
      ))}
      {element}
    </>
  );
}
