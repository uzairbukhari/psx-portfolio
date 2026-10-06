import { failure, requireSuperAdmin } from '@/lib/server';

/** Temporary: reports whether MUFAP answers a request made from this Worker (Cloudflare egress). Remove after testing. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const res = await fetch('https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=3', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.mufap.com.pk/',
      },
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    return Response.json({ status: res.status, length: text.length, fundLinks: (text.match(/FundDetail\?FundID=/g) ?? []).length, head: text.slice(0, 200) });
  } catch (e) {
    return failure(e);
  }
}
