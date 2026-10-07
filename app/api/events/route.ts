import { env } from 'cloudflare:workers';
import { getViewer } from '@/lib/auth';
import { parseBatch } from '@/lib/analytics-events';
import { purgeOldEvents, recordBatch, resolveOrigin, userKey } from '@/lib/analytics-store';
import { takeRateLimit } from '@/lib/rate-limit';
import { readLimited } from '@/lib/read-limited';
import { db, failure } from '@/lib/server';
import { UserError } from '@/lib/user-error';

// Usage events from the web and phone apps. Only catalog events with closed-enum props are stored (see
// lib/analytics-events.ts), so nothing here can carry a ticker, amount or note. Signed-out visitors may send landing
// events under an anonymous id; signed-in events are keyed by an HMAC of the email, never the email itself.
export async function POST(req: Request) {
  try {
    const viewer = await getViewer();
    // Cookie sessions are subject to the same-origin check; bearer tokens are not sent by browsers on their own.
    if (viewer?.via !== 'bearer' && req.headers.get('origin') !== new URL(req.url).origin)
      throw new UserError('Invalid request origin.', 403);
    const bytes = await readLimited(req, 20_000, 'Request is too large.');
    const batch = parseBatch(JSON.parse(new TextDecoder().decode(bytes)));
    if (!batch) throw new UserError('Invalid events.', 400);
    const database = db();
    const who = viewer ? await userKey(viewer.email, env.SESSION_SECRET ?? '') : `ip:${req.headers.get('cf-connecting-ip') ?? 'unknown'}`;
    const limit = await takeRateLimit(database, who, 'events', { windowMs: 60_000, max: 60 });
    if (!limit.allowed) return new Response(null, { status: 204 });
    // Signed-out visitors can only send a few public-page events.
    const events = viewer ? batch.events : batch.events.filter((e) =>
      e.event === 'landing_viewed' || e.event === 'sign_in_clicked' || (e.event === 'screen_viewed' && ['landing', 'privacy', 'terms', 'sign_in'].includes(e.props.screen)));
    const admin = viewer?.role === 'super_admin';
    await recordBatch(database, { ...batch, events }, viewer ? who : null, admin);
    const state = events.find((e) => e.event === 'account_state');
    if (viewer && state) await resolveOrigin(database, viewer.email, state.props.vault === 'exists', env.SESSION_SECRET ?? '', admin);
    if (Math.random() < 0.01) await purgeOldEvents(database);
    return new Response(null, { status: 204 });
  } catch (e) {
    return failure(e);
  }
}
