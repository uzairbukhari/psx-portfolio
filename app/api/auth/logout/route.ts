import { safeRelativeReturnPath } from '@/lib/auth';
import { serializeExpiredCookie } from '@/lib/session';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get('return_to') ?? '/');
  const headers = new Headers({
    Location: new URL(returnTo, url.origin).toString(),
  });
  headers.append('Set-Cookie', serializeExpiredCookie('session'));
  return new Response(null, { status: 302, headers });
}
