import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { readBearerToken, verifyMobileToken } from '@/lib/mobile-token';
import { UserError } from '@/lib/user-error';

/** Device-session id of the calling phone, from its bearer token. Cookie (browser) callers are refused. */
export async function currentMobileSid(email: string): Promise<string> {
  const bearer = readBearerToken((await headers()).get('authorization'));
  const mobile = bearer && env.SESSION_SECRET ? await verifyMobileToken(bearer, env.SESSION_SECRET) : null;
  if (!mobile || mobile.email.toLowerCase() !== email.toLowerCase())
    throw new UserError('This is only available in the phone app.', 400);
  return mobile.sid;
}
