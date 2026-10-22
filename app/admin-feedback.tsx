'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  FEEDBACK_KIND_LABEL,
  FEEDBACK_STATUSES,
  type FeedbackRow,
  type FeedbackStatus,
} from '@/lib/feedback';
import { readJson } from '@/lib/safe-json';

type Report = {
  items: FeedbackRow[];
  hasMore: boolean;
  counts: Record<FeedbackStatus, number>;
};
const LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  read: 'Read',
  resolved: 'Resolved',
  spam: 'Spam',
};

/** Feedback inbox (GET/POST /api/admin/feedback): newest first, filter by status, mark read, resolved or spam. */
export default function AdminFeedback() {
  const [status, setStatus] = useState<FeedbackStatus | ''>('new');
  const [offset, setOffset] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/feedback?offset=${offset}${status ? `&status=${status}` : ''}`,
        { cache: 'no-store' },
      );
      const body = (await readJson(res)) as Report & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load feedback.');
      setReport(body);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load feedback.');
    }
  }, [status, offset]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function mark(id: number, next: FeedbackStatus) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      });
      if (!res.ok)
        throw new Error(
          ((await readJson(res)) as { error?: string }).error ??
            'Could not update.',
        );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  if (!report)
    return error ? (
      <p role="alert" className="notice error">
        {error}
      </p>
    ) : (
      <p className="muted">Loading…</p>
    );
  return (
    <div>
      <fieldset className="audit-filters" aria-label="Status">
        {(['', ...FEEDBACK_STATUSES] as const).map((s) => (
          <Button
            key={s || 'all'}
            type="button"
            size="sm"
            variant={s === status ? 'default' : 'outline'}
            aria-pressed={s === status}
            onClick={() => {
              setStatus(s);
              setOffset(0);
            }}
          >
            {s ? `${LABEL[s]} (${report.counts[s]})` : 'All'}
          </Button>
        ))}
      </fieldset>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {report.items.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <ul className="fb-inbox">
          {report.items.map((r) => (
            <li key={r.id} data-status={r.status}>
              <header>
                <b>{FEEDBACK_KIND_LABEL[r.kind]}</b>
                <span className="muted">
                  {new Date(r.createdAt).toLocaleString()} ·{' '}
                  {r.signedIn ? 'signed in' : 'signed out'} · {r.platform}
                  {r.page ? ` · ${r.page}` : ''}
                </span>
                <span className="fb-status">{LABEL[r.status]}</span>
              </header>
              <p>{r.message}</p>
              <footer>
                {r.contactEmail ? (
                  <a href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a>
                ) : (
                  <span className="muted">No reply address</span>
                )}
                <span className="fb-grow" />
                {FEEDBACK_STATUSES.filter((s) => s !== r.status).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void mark(r.id, s)}
                  >
                    Mark {LABEL[s].toLowerCase()}
                  </Button>
                ))}
              </footer>
            </li>
          ))}
        </ul>
      )}
      <div className="fb-pager">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Newer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!report.hasMore}
          onClick={() => setOffset(offset + 50)}
        >
          Older
        </Button>
      </div>
    </div>
  );
}
