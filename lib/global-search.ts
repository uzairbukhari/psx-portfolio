// Matching for the top search bar: companies, funds, gold and silver, currency and savings plans. Pure, so it can be
// tested; the bar feeds it the user's own holdings plus the public company directory.
export type SearchKind = 'company' | 'fund' | 'metal' | 'currency' | 'plan';
export type SearchItem = {
  kind: SearchKind;
  /** Company symbol, or the asset key the page opens by. */
  key: string;
  label: string;
  sub: string;
  /** Extra words that should match (sector, AMC, karat...). */
  haystack?: string;
  /** In the user's portfolio: listed before directory hits. */
  owned?: boolean;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  company: 'Companies',
  fund: 'Funds',
  metal: 'Gold & silver',
  currency: 'Currency',
  plan: 'Savings plans',
};
const KIND_ORDER: SearchKind[] = [
  'company',
  'fund',
  'metal',
  'currency',
  'plan',
];

/** Rank 0 = symbol equals the query, 1 = symbol or name starts with it, 2 = contains it, null = no match. */
function rank(item: SearchItem, q: string): number | null {
  const key = item.key.toLowerCase();
  const label = item.label.toLowerCase();
  if (item.kind === 'company' && key === q) return 0;
  if (key.startsWith(q) && item.kind === 'company') return 1;
  if (label.startsWith(q) || label.split(/\s+/).some((w) => w.startsWith(q)))
    return 1;
  return `${label} ${item.sub} ${item.haystack ?? ''} ${item.kind === 'company' ? key : ''}`
    .toLowerCase()
    .includes(q)
    ? 2
    : null;
}

/** Matches grouped in a fixed order (companies first), best match and the user's own items first within a group. */
export function searchItems(
  items: SearchItem[],
  query: string,
  perKind = 6,
): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const hits = items.flatMap((item) => {
    const id = `${item.kind}:${item.key}`;
    if (seen.has(id)) return [];
    const r = rank(item, q);
    if (r === null) return [];
    seen.add(id);
    return [{ item, r }];
  });
  return KIND_ORDER.flatMap((kind) =>
    hits
      .filter((h) => h.item.kind === kind)
      .sort(
        (a, b) =>
          a.r - b.r ||
          Number(!!b.item.owned) - Number(!!a.item.owned) ||
          a.item.label.localeCompare(b.item.label),
      )
      .slice(0, perKind)
      .map((h) => h.item),
  );
}
