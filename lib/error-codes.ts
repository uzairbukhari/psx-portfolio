// Turns an error message into a closed category and code for the super-admin audit log. The message itself never
// leaves the device: only the matched `area` and `code` are sent (see EVENT_CATALOG.client_error). Anything not
// recognised becomes other/unknown. Pure module (no Workers imports) so the phone app can import it.

export const ERROR_AREAS = ['import', 'sync', 'vault', 'prices', 'auth', 'picks', 'app', 'other'] as const;
export type ErrorArea = (typeof ERROR_AREAS)[number];

export const ERROR_CODES = [
  'pdf_unrecognized', 'pdf_no_text', 'pdf_line_unreadable', 'unsupported_file', 'wrong_import_card', 'import_invalid',
  'chunk_load', 'network', 'save_conflict', 'vault_locked', 'vault_wrong_password', 'rate_limited', 'forbidden',
  'server_error', 'price_refresh_failed', 'uncaught', 'unknown',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const RULES: [RegExp, ErrorArea, ErrorCode][] = [
  [/dynamically imported module|importing a module script|loading chunk|ChunkLoadError|PDF reader could not load/i, 'app', 'chunk_load'],
  [/don.t recognize this broker|could not be read from this statement|Choose a PSX broker/i, 'import', 'pdf_unrecognized'],
  [/No readable text|Scanned statements/i, 'import', 'pdf_no_text'],
  [/trade line in this statement could not be read|ledger line has an invalid/i, 'import', 'pdf_line_unreadable'],
  [/not one of the supported imports|supported import/i, 'import', 'unsupported_file'],
  [/looks like a .* file, not/i, 'import', 'wrong_import_card'],
  [/needs correction in the source file|statement result is incomplete|No trades|No rows matched/i, 'import', 'import_invalid'],
  [/changed in another tab|newer version|revision|stale|conflict/i, 'sync', 'save_conflict'],
  [/wrong password|incorrect password|could not unlock|decrypt/i, 'vault', 'vault_wrong_password'],
  [/vault is locked|unlock/i, 'vault', 'vault_locked'],
  [/too many requests|rate limit/i, 'sync', 'rate_limited'],
  [/forbidden|not allowed|super admin|403/i, 'auth', 'forbidden'],
  [/refresh.*(price|quote)|(price|quote).*refresh/i, 'prices', 'price_refresh_failed'],
  [/failed to fetch|network|offline|timed out|load failed/i, 'sync', 'network'],
  [/server error|internal error|(?:HTTP|status) 5\d\d/i, 'sync', 'server_error'],
];

export function classifyError(message: string, fallbackArea: ErrorArea = 'other', fallbackCode: ErrorCode = 'unknown'): { area: ErrorArea; code: ErrorCode } {
  const text = String(message ?? '').slice(0, 500);
  for (const [pattern, area, code] of RULES) if (pattern.test(text)) return { area, code };
  return { area: fallbackArea, code: fallbackCode };
}
