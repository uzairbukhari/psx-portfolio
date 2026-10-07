import type { Portfolio } from './portfolio.ts';
import type { IncomingEvent } from './analytics-events.ts';

// Turns a successful portfolio save into usage events by comparing the portfolio before and after. Only the kind of
// change leaves this function (for example `entry_added { kind: 'buy' }`); no ticker, amount, date or id does.

const idSet = (rows: { id: string }[] | undefined) => new Set((rows ?? []).map((r) => r.id));

export function eventsForSave(prev: Portfolio | null, next: Portfolio, importSource?: IncomingEvent['props']['source']): IncomingEvent[] {
  const out: IncomingEvent[] = [];
  if (importSource) out.push({ event: 'import_completed', props: { source: importSource } });
  if (!prev) return out;
  if (!importSource) {
    const before = idSet(prev.trades);
    const prevById = new Map(prev.trades.map((t) => [t.id, t]));
    const kindOf = (t: { kind: string }) => (t.kind === 'adjustment' ? 'other' : t.kind);
    const added = next.trades.filter((t) => !before.has(t.id)).map(kindOf);
    const removed = next.trades.filter((t) => before.has(t.id) && t.voided && !prevById.get(t.id)?.voided).map(kindOf);
    // A correction voids the old row and adds a new one: count that once, as an edit.
    if (removed.length && added.length === removed.length) for (const kind of added) out.push({ event: 'entry_edited', props: { kind } });
    else {
      for (const kind of added) out.push({ event: 'entry_added', props: { kind } });
      for (const kind of removed) out.push({ event: 'entry_deleted', props: { kind } });
    }
    const divBefore = idSet(prev.dividends);
    for (const d of next.dividends ?? [])
      if (!divBefore.has(d.id) && d.source !== 'auto') out.push({ event: 'entry_added', props: { kind: 'dividend' } });
    if (next.stockSplits && next.stockSplits.length > (prev.stockSplits?.length ?? 0))
      out.push({ event: 'entry_added', props: { kind: 'split' } });
  }
  const assetsBefore = idSet(prev.assets);
  for (const a of next.assets ?? []) {
    if (assetsBefore.has(a.id)) continue;
    const cls = a.kind === 'metal' ? a.metal : a.kind;
    if (cls === 'gold' || cls === 'silver' || cls === 'fund' || cls === 'plan') out.push({ event: 'asset_added', props: { class: cls } });
  }
  if (JSON.stringify(prev.budgets) !== JSON.stringify(next.budgets)) out.push({ event: 'targets_saved', props: {} });
  return out;
}

const IMPORT_SOURCES = ['ahl', 'finqalab', 'broker', 'ipo'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

/** Which import produced a save: the source tag on the newly added rows, defaulting to a broker file. */
export function importSourceOf(prev: Portfolio | null, next: Portfolio): ImportSource {
  const before = idSet(prev?.trades);
  for (const t of next.trades)
    if (!before.has(t.id) && t.source && (IMPORT_SOURCES as readonly string[]).includes(t.source)) return t.source as ImportSource;
  return 'broker';
}

/** The import behind a save, when every newly added trade carries an import source tag; null for a manual edit. */
export function detectImport(prev: Portfolio | null, next: Portfolio): ImportSource | null {
  const before = idSet(prev?.trades);
  const added = next.trades.filter((t) => !before.has(t.id));
  if (!added.length || !added.every((t) => t.source && (IMPORT_SOURCES as readonly string[]).includes(t.source))) return null;
  return importSourceOf(prev, next);
}
