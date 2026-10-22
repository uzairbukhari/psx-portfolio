import { env } from 'cloudflare:workers';
import { getViewer } from '@/lib/auth';
import { parseFeedback, purgeOldFeedback, saveFeedback, supportAddress } from '@/lib/feedback';
import { userKey } from '@/lib/analytics-store';
import { takeRateLimit, waitText } from '@/lib/rate-limit';
import { readLimited } from '@/lib/read-limited';
import { db, failure } from '@/lib/server';
import { verifyTurnstile } from '@/lib/turnstile';
import { UserError } from '@/lib/user-error';

// Contact us / Report an issue / Suggest a feature. Open to signed-out visitors (Turnstile captcha, per-IP limit) and
// to signed-in people (same-origin check, per-account limit). The body is only what the person typed plus the page
// and platform: nothing from the encrypted portfolio is read or accepted here.
export async function GET() {
  return Response.json({ supportEmail: supportAddress(env.SUPPORT_EMAIL) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  try {
    const viewer = await getViewer();
    if (viewer?.via !== 'bearer' && req.headers.get('origin') !== new URL(req.url).origin)
      throw new UserError('Invalid request origin.', 403);
    const bytes = await readLimited(req, 8_000, 'Request is too large.');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    } catch {
      throw new UserError('Invalid request.', 400);
    }
    // A hidden field a person never fills in: bots that do get an apparent success and nothing is stored.
    if (typeof body.website === 'string' && body.website) return Response.json({ ok: true });
    const input = parseFeedback(body);
    if (typeof input === 'string') throw new UserError(input, 400);
    const database = db();
    const ip = req.headers.get('cf-connecting-ip');
    if (!viewer) {
      if (!env.TURNSTILE_SECRET_KEY) throw new UserError('Sending without signing in is not available yet. Sign in to send this.', 503);
      if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.captcha, ip)))
        throw new UserError('Please complete the check and try again.', 400, 'captcha');
    }
    const secret = env.SESSION_SECRET ?? '';
    const key = viewer ? await userKey(viewer.email, secret) : null;
    const who = key ?? `ip:${ip ?? 'unknown'}`;
    const limit = await takeRateLimit(database, who, 'feedback', { windowMs: 3_600_000, max: viewer ? 5 : 3 });
    if (!limit.allowed) throw new UserError(`You have sent a few messages already. Try again in ${waitText(limit.retryAfterMs)}.`, 429);
    if (!viewer) {
      // One shared ceiling so a botnet cannot flood the inbox even if every check passes.
      const global = await takeRateLimit(database, 'all', 'feedback-public', { windowMs: 3_600_000, max: 40 });
      if (!global.allowed) throw new UserError('We are getting a lot of messages right now. Try again later.', 429);
    }
    await saveFeedback(database, input, !!viewer, key);
    if (Math.random() < 0.02) await purgeOldFeedback(database).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
