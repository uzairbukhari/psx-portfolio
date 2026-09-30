'use client';
import { useState, type ReactNode } from 'react';
import { ConflictError } from '../hooks/use-portfolio';
import { usePortfolioContext } from '../portfolio-context';

/**
 * Submit state shared by every ledger dialog. Errors stay inside the dialog (where the user is
 * looking) and the draft is never cleared, so a failed or conflicting save loses nothing.
 */
export function useSubmit() {
  const { reload } = usePortfolioContext();
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [attempted, setAttempted] = useState(false);

  async function run(action: () => Promise<void>) {
    setAttempted(true);
    setError('');
    setConflict(false);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConflict(e instanceof ConflictError);
    }
  }
  async function reloadLatest() {
    try {
      await reload();
      setError('');
      setConflict(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return { error, conflict, attempted, run, reloadLatest, setError };
}

export function DialogError({
  error,
  conflict,
  onReload,
}: {
  error: string;
  conflict: boolean;
  onReload: () => void;
}): ReactNode {
  if (!error) return null;
  return (
    <div className="form-alert" role="alert">
      <span>{error}</span>
      {conflict && (
        <span className="form-alert-action">
          Your entries are kept.{' '}
          <button type="button" data-slot="link" className="link-button" onClick={onReload}>
            Load latest data
          </button>
          , then save again.
        </span>
      )}
    </div>
  );
}

/** Label + control + inline error, wired for assistive technology. */
export function Field({
  label,
  error,
  hint,
  wide,
  id,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  wide?: boolean;
  id: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean | undefined;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={'field' + (wide ? ' wide' : '')}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })}
      {error ? (
        <small id={`${id}-error`} className="field-error">
          {error}
        </small>
      ) : hint ? (
        <small id={`${id}-hint`} className="field-hint">
          {hint}
        </small>
      ) : null}
    </div>
  );
}
