// Failures the Worker itself answered with a 5xx, kept as counts per route, code and minute for the admin console.
// Only the route path and a closed code are stored: never the message, the request body or who asked.
export type ServerErrorCode = 'worker_limit' | 'db_error' | 'timeout' | 'upstream' | 'server_error';

export function classifyServerError(error: unknown, status: number): ServerErrorCode {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : '';
  if (/exceeded (cpu|memory|resource)|resource limits|too many subrequests|subrequest limit/i.test(text)) return 'worker_limit';
  if (/D1_|SQLITE|database|no such table|constraint failed/i.test(text)) return 'db_error';
  if (/timed? ?out|AbortError|TimeoutError/i.test(text) || status === 504) return 'timeout';
  if (status === 502 || status === 503 || /fetch failed|network|upstream/i.test(text)) return 'upstream';
  return 'server_error';
}

/** Path only, with ids and long tokens collapsed, so one route is one row however it is called. */
export function routeLabel(url: string): string {
  let path = '/';
  try { path = new URL(url, 'https://x.invalid').pathname; } catch { /* keep the root */ }
  const cleaned = path.split('/').map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) ? ':id' : seg.slice(0, 40))).join('/');
  return cleaned.slice(0, 80) || '/';
}

const minuteOf = (d: Date) => d.toISOString().slice(0, 16);

export async function recordServerError(
  db: Pick<D1Database, 'prepare'>, route: string, code: ServerErrorCode, status: number, now = new Date(),
): Promise<void> {
  await db.prepare(
    `INSERT INTO server_errors (route,code,minute,status,n) VALUES (?,?,?,?,1)
     ON CONFLICT(route,code,minute) DO UPDATE SET n=n+1`,
  ).bind(route, code, minuteOf(now), status).run();
}

export async function pruneServerErrors(db: Pick<D1Database, 'prepare'>, now = new Date()): Promise<void> {
  await db.prepare('DELETE FROM server_errors WHERE minute<?').bind(minuteOf(new Date(now.getTime() - 30 * 86_400_000))).run();
}

export type ServerErrorSummary = {
  last24h: number; previous24h: number; lastHour: number;
  byRoute: { route: string; code: string; n: number; lastAt: string }[];
  series: { day: string; n: number }[];
};

export async function serverErrorSummary(db: D1Database, now = new Date()): Promise<ServerErrorSummary> {
  const at = (hours: number) => minuteOf(new Date(now.getTime() - hours * 3_600_000));
  const sum = async (from: string, to: string) =>
    (await db.prepare('SELECT COALESCE(SUM(n),0) AS n FROM server_errors WHERE minute>=? AND minute<?').bind(from, to).first<{ n: number }>())?.n ?? 0;
  const end = minuteOf(new Date(now.getTime() + 60_000));
  const byRoute = (await db.prepare(
    'SELECT route,code,SUM(n) AS n,MAX(minute) AS lastAt FROM server_errors WHERE minute>=? GROUP BY route,code ORDER BY n DESC LIMIT 12',
  ).bind(at(24)).all<{ route: string; code: string; n: number; lastAt: string }>()).results;
  const days = (await db.prepare(
    'SELECT substr(minute,1,10) AS day, SUM(n) AS n FROM server_errors WHERE minute>=? GROUP BY day ORDER BY day',
  ).bind(at(24 * 7)).all<{ day: string; n: number }>()).results;
  return {
    last24h: await sum(at(24), end), previous24h: await sum(at(48), at(24)), lastHour: await sum(at(1), end), byRoute,
    series: Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day, n: days.find((d) => d.day === day)?.n ?? 0 };
    }),
  };
}
