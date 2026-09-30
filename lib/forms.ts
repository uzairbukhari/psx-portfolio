/** Parses a numeric form field. Empty or non-numeric text is `null` (invalid), never 0. */
export function parseField(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Text for a number pre-filled into a form field. */
export const fieldText = (n: number | null | undefined): string =>
  n === null || n === undefined ? '' : String(n);

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export const hasErrors = (errors: object): boolean =>
  Object.keys(errors).length > 0;
