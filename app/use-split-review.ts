'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PublicDataResponse } from '@/lib/api-types';
import {
  possibleSplits, proposeSplits, splitFromProposal,
  type Activity, type CorporateAction, type PossibleSplit, type SplitProposal,
} from '@/lib/import-splits';
import { dateOK, today, type Portfolio, type StockSplit } from '@/lib/portfolio';
import { readJson } from '@/lib/safe-json';

export type PossibleEdit = { checked: boolean; oldShares: number; newShares: number; date: string };

export type SplitReview = {
  loading: boolean;
  error: string;
  proposals: SplitProposal[];
  possible: PossibleSplit[];
  checked: Record<string, boolean>;
  setChecked: (key: string, value: boolean) => void;
  edits: Record<string, PossibleEdit>;
  setEdit: (item: PossibleSplit, patch: Partial<PossibleEdit>) => void;
  /** Splits the user accepted; passed to the planner and added with the import. */
  splits: StockSplit[];
};

/**
 * Looks up public split evidence for the tickers an import touches (only ticker symbols are sent) and keeps the
 * user's choices. `activity` must be memoised by the caller: it is the dated trades the import would add.
 */
export function useSplitReview(portfolio: Portfolio, activity: Activity[]): SplitReview {
  const tickerKey = useMemo(() => [...new Set(activity.map((a) => a.ticker))].sort().join(','), [activity]);
  const [loaded, setLoaded] = useState<{ key: string; evidence: CorporateAction[]; error: string } | null>(null);
  const done = loaded?.key === tickerKey;
  const loading = !!tickerKey && !done;
  const evidence = useMemo(() => (done ? loaded.evidence : []), [done, loaded]);
  const error = done ? loaded.error : '';
  const [checkedState, setCheckedState] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, PossibleEdit>>({});

  useEffect(() => {
    if (!tickerKey) return;
    let live = true;
    const parts = tickerKey.split(',');
    const chunks = Array.from({ length: Math.ceil(parts.length / 100) }, (_, i) => parts.slice(i * 100, (i + 1) * 100));
    void Promise.all(chunks.map(async (part) => {
      const response = await fetch(`/api/public-data?tickers=${encodeURIComponent(part.join(','))}`);
      if (!response.ok) throw new Error('Split lookup failed.');
      return ((await readJson(response)) as PublicDataResponse).corporateActions ?? [];
    }))
      .then((lists) => { if (live) setLoaded({ key: tickerKey, evidence: lists.flat(), error: '' }); })
      .catch(() => { if (live) setLoaded({ key: tickerKey, evidence: [], error: 'Could not check for stock splits. You can still import, then add a split by hand if needed.' }); });
    return () => { live = false; };
  }, [tickerKey]);

  const proposals = useMemo(() => proposeSplits(portfolio, activity, evidence), [portfolio, activity, evidence]);
  const possible = useMemo(
    () => possibleSplits(portfolio, activity, proposals.map((p) => ({ ticker: p.ticker, date: p.date }))),
    [portfolio, activity, proposals],
  );
  const editFor = (item: PossibleSplit): PossibleEdit => edits[item.key] ?? { checked: false, oldShares: 1, newShares: item.ratio, date: item.toDate };

  const splits = useMemo(() => {
    const out: StockSplit[] = proposals.filter((p) => checkedState[p.key] ?? true).map((p) => splitFromProposal(p, `import-${p.key}`));
    for (const item of possible) {
      const e = edits[item.key];
      if (!e?.checked || !dateOK(e.date) || e.date > today()) continue;
      if (!Number.isSafeInteger(e.oldShares) || !Number.isSafeInteger(e.newShares) || e.oldShares <= 0 || e.newShares <= e.oldShares) continue;
      out.push({
        id: `import-${item.key}`, ticker: item.ticker, date: e.date, oldShares: e.oldShares, newShares: e.newShares,
        note: `${e.newShares}-for-${e.oldShares} split added by you while importing (price fell from ${item.fromPrice} to ${item.toPrice}).`,
        source: 'import', externalId: `split:${item.ticker}:${e.date}:${e.oldShares}:${e.newShares}`,
      });
    }
    return out;
  }, [proposals, possible, checkedState, edits]);

  return {
    loading, error, proposals, possible,
    checked: Object.fromEntries(proposals.map((p) => [p.key, checkedState[p.key] ?? true])),
    setChecked: (key, value) => setCheckedState((c) => ({ ...c, [key]: value })),
    edits: Object.fromEntries(possible.map((p) => [p.key, editFor(p)])),
    setEdit: (item, patch) => setEdits((all) => ({ ...all, [item.key]: { ...editFor(item), ...all[item.key], ...patch } })),
    splits,
  };
}
