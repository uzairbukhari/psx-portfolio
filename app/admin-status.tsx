import type { PipelineStatus } from '@/lib/pipelines';

const LABEL: Record<PipelineStatus, string> = { ok: 'OK', late: 'Late', failing: 'Failing', idle: 'Idle' };

/** Status as a pill with a text label, so colour is never the only signal. */
export function StatusPill({ status, label }: { status: PipelineStatus | 'info'; label?: string }) {
  const kind = status === 'info' ? 'idle' : status;
  return <span className={`admin-pill ${kind}`}><i aria-hidden="true" />{label ?? LABEL[kind]}</span>;
}

export function Refresher({ updatedAt, loading, onRefresh }: { updatedAt: number | null; loading: boolean; onRefresh: () => void }) {
  return (
    <div className="admin-refresh">
      <span className="muted">{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Loading…'}</span>
      <button type="button" className="secondary compact" disabled={loading} onClick={onRefresh}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div>
  );
}
