type Entry = { id: string; voided?: boolean };

/**
 * Applies a ledger correction without losing the audit trail: the entry being corrected is
 * kept but marked voided, and the replacement is inserted right after it. With no
 * `replacingId` (or an id that is not in the list) the entry is appended.
 * Returns a new array; the input list and its entries are not modified.
 */
export function replaceEntry<T extends Entry>(
  list: readonly T[],
  replacingId: string | null | undefined,
  entry: T,
): T[] {
  const index = replacingId ? list.findIndex((item) => item.id === replacingId) : -1;
  if (index < 0) return [...list, entry];
  const next = list.map((item, i) => (i === index ? { ...item, voided: true } : item));
  next.splice(index + 1, 0, entry);
  return next;
}

/** Marks one entry voided (or restores it with `voided = false`); entries are never deleted. */
export function voidEntry<T extends Entry>(
  list: readonly T[],
  id: string,
  voided = true,
): T[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    const { voided: _previous, ...rest } = item;
    return (voided ? { ...rest, voided: true } : rest) as T;
  });
}
