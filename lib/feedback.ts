// Contact us / Report an issue / Suggest a feature. Shared-safe validation plus the D1 store. Submissions carry free text
// the person typed on purpose and nothing from the encrypted portfolio: the form never reads the vault, and the notes
// say so. Stored in the main D1 (never VAULT_DB).
export const FEEDBACK_KINDS = ['contact', 'issue', 'feature'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_STATUSES = ['new', 'read', 'resolved', 'spam'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const FEEDBACK_PLATFORMS = ['web', 'android', 'ios'] as const;

export const FEEDBACK_MAX_MESSAGE = 2000;
export const FEEDBACK_MIN_MESSAGE = 10;
export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  contact: 'Contact us',
  issue: 'Report an issue',
  feature: 'Suggest a feature',
};

export type FeedbackInput = {
  kind: FeedbackKind;
  message: string;
  contactEmail: string | null;
  page: string;
  platform: (typeof FEEDBACK_PLATFORMS)[number];
  appVersion: string | null;
};

export type FeedbackRow = {
  id: number;
  createdAt: string;
  kind: FeedbackKind;
  message: string;
  contactEmail: string | null;
  signedIn: boolean;
  page: string;
  platform: string;
  appVersion: string | null;
  status: FeedbackStatus;
  note: string | null;
};

const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[^\s@<>]{2,24}$/;

/** Returns the cleaned input or an error sentence for the person. Honeypot filling is checked by the caller. */
export function parseFeedback(raw: unknown): FeedbackInput | string {
  if (!raw || typeof raw !== 'object') return 'Invalid request.';
  const body = raw as Record<string, unknown>;
  const kind = FEEDBACK_KINDS.find((k) => k === body.kind);
  if (!kind) return 'Choose what you want to send.';
  const message =
    typeof body.message === 'string'
      ? body.message.replace(/\r\n/g, '\n').trim()
      : '';
  if (message.length < FEEDBACK_MIN_MESSAGE)
    return 'Tell us a little more (at least a sentence).';
  if (message.length > FEEDBACK_MAX_MESSAGE)
    return `Keep it under ${FEEDBACK_MAX_MESSAGE} characters.`;
  let contactEmail: string | null = null;
  if (typeof body.contactEmail === 'string' && body.contactEmail.trim()) {
    contactEmail = body.contactEmail.trim().toLowerCase();
    if (contactEmail.length > 254 || !EMAIL.test(contactEmail))
      return 'That email address does not look right.';
  }
  const page =
    typeof body.page === 'string'
      ? body.page
          .split(/[?#]/)[0]
          .replace(/[^A-Za-z0-9/_\-.]/g, '')
          .slice(0, 80)
      : '';
  const platform = FEEDBACK_PLATFORMS.find((p) => p === body.platform) ?? 'web';
  const appVersion =
    typeof body.appVersion === 'string' &&
    /^[A-Za-z0-9._-]{1,24}$/.test(body.appVersion)
      ? body.appVersion
      : null;
  return { kind, message, contactEmail, page, platform, appVersion };
}

/** A bare "name@host" support address from the SUPPORT_EMAIL setting, or null when it is unset or malformed. */
export function supportAddress(
  value: string | undefined | null,
): string | null {
  const v = (value ?? '').trim().toLowerCase();
  return v && EMAIL.test(v) ? v : null;
}

export async function saveFeedback(
  db: D1Database,
  input: FeedbackInput,
  signedIn: boolean,
  userKey: string | null,
  now = new Date(),
) {
  await db
    .prepare(
      `INSERT INTO feedback (created_at,kind,message,contact_email,signed_in,user_key,page,platform,app_version,status)
       VALUES (?,?,?,?,?,?,?,?,?, 'new')`,
    )
    .bind(
      now.toISOString(),
      input.kind,
      input.message,
      input.contactEmail,
      signedIn ? 1 : 0,
      userKey,
      input.page,
      input.platform,
      input.appVersion,
    )
    .run();
}

type Raw = {
  id: number;
  created_at: string;
  kind: FeedbackKind;
  message: string;
  contact_email: string | null;
  signed_in: number;
  page: string;
  platform: string;
  app_version: string | null;
  status: FeedbackStatus;
  note: string | null;
};

/** One page of submissions, newest first, plus per-status counts. Two small queries on an indexed table. */
export async function listFeedback(
  db: D1Database,
  opts: { status?: FeedbackStatus; offset?: number },
) {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const where = opts.status ? 'WHERE status=?' : '';
  const bind = opts.status ? [opts.status] : [];
  const rows = await db
    .prepare(
      `SELECT id,created_at,kind,message,contact_email,signed_in,page,platform,app_version,status,note
       FROM feedback ${where} ORDER BY id DESC LIMIT 51 OFFSET ?`,
    )
    .bind(...bind, offset)
    .all<Raw>();
  const counts = await db
    .prepare('SELECT status, COUNT(*) AS n FROM feedback GROUP BY status')
    .all<{ status: FeedbackStatus; n: number }>();
  const items: FeedbackRow[] = (rows.results ?? []).slice(0, 50).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    message: r.message,
    contactEmail: r.contact_email,
    signedIn: r.signed_in === 1,
    page: r.page,
    platform: r.platform,
    appVersion: r.app_version,
    status: r.status,
    note: r.note,
  }));
  const byStatus: Record<FeedbackStatus, number> = {
    new: 0,
    read: 0,
    resolved: 0,
    spam: 0,
  };
  for (const c of counts.results ?? [])
    if (c.status in byStatus) byStatus[c.status] = c.n;
  return { items, hasMore: (rows.results ?? []).length > 50, counts: byStatus };
}

export async function updateFeedback(
  db: D1Database,
  id: number,
  patch: { status?: unknown; note?: unknown },
) {
  const status = FEEDBACK_STATUSES.find((s) => s === patch.status);
  const note =
    typeof patch.note === 'string'
      ? patch.note.trim().slice(0, 1000) || null
      : undefined;
  if (!Number.isInteger(id) || id < 1 || (!status && note === undefined))
    return false;
  await db
    .prepare(
      'UPDATE feedback SET status=COALESCE(?,status), note=CASE WHEN ?=1 THEN ? ELSE note END, updated_at=? WHERE id=?',
    )
    .bind(
      status ?? null,
      note === undefined ? 0 : 1,
      note ?? null,
      new Date().toISOString(),
      id,
    )
    .run();
  return true;
}

/** Resolved and spam entries older than a year go; open ones stay until someone deals with them. */
export async function purgeOldFeedback(db: D1Database, now = new Date()) {
  const cutoff = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  await db
    .prepare(
      "DELETE FROM feedback WHERE status IN ('resolved','spam') AND created_at<?",
    )
    .bind(cutoff)
    .run();
}
