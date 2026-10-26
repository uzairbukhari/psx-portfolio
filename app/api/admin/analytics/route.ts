import { env, waitUntil } from 'cloudflare:workers';
import { adminCached } from '@/lib/admin-cache';
import { internalUserKeys } from '@/lib/internal-accounts';
import { pktDay } from '@/lib/analytics-report';
import { LENSES, type Lens, type LensQuery } from '@/lib/analytics-lenses';
import { lensReport } from '@/lib/analytics-lens-store';
import { parseStep } from '@/lib/analytics-journey';
import { PLATFORM_FILTERS, SEGMENTS, type PlatformFilter, type Segment } from '@/lib/analytics-rows';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

/**
 * One Analytics lens (`?lens=`) for the super admin (Summary, Journeys, Engagement, Acquisition, Quality). Usage events only:
 * catalog names, closed-enum props and HMAC user keys. No private portfolio data exists in this database.
 */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const s = new URL(req.url).searchParams;
    const lens = s.get('lens') ?? 'summary';
    if (!(LENSES as readonly string[]).includes(lens)) throw new UserError('Unknown analytics view.', 404);
    const days = [7, 30, 90].includes(Number(s.get('days'))) ? Number(s.get('days')) : 30;
    const platform = (PLATFORM_FILTERS as readonly string[]).includes(s.get('platform') ?? '') ? (s.get('platform') as PlatformFilter) : 'all';
    const segment = (SEGMENTS as readonly string[]).includes(s.get('segment') ?? '') ? (s.get('segment') as Segment) : 'all';
    const steps = (s.get('steps') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8);
    if (steps.some((x) => !parseStep(x))) throw new UserError('A funnel step is not in the event catalog.', 400);
    const windowDays = [1, 7, 14, 30].includes(Number(s.get('window'))) ? Number(s.get('window')) : 14;
    const anchor = /^(screen:)?[a-z_]{1,40}$/.test(s.get('anchor') ?? '') ? s.get('anchor')! : undefined;
    const direction = s.get('direction') === 'prev' ? 'prev' : 'next';
    const vitalScreen = /^[a-z_]{1,20}$/.test(s.get('screen') ?? '') ? s.get('screen')! : undefined;
    const includeAdmin = s.get('admin') === '1';
    const now = new Date();
    const q: LensQuery = { lens: lens as Lens, days, today: pktDay(now), platform, segment, steps, windowDays, anchor, direction, vitalScreen };
    const database = db();
    const key = `analytics:${lens}:${days}:${platform}:${segment}:${includeAdmin ? 1 : 0}:${steps.join(',')}:${windowDays}:${anchor ?? ''}:${direction}:${vitalScreen ?? ''}`;
    const report = await adminCached(req, key, async () => {
      const keys = includeAdmin ? [] : await internalUserKeys(database, env.SESSION_SECRET ?? '');
      return lensReport(database, env.SESSION_SECRET ?? '', q, includeAdmin, keys, now);
    }, waitUntil);
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error, undefined, req);
  }
}
