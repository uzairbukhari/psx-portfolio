import { failure, identity } from '@/lib/server';
import { credibleResearchHost, isPrivateOrLocalHost } from '@/lib/research-policy.mjs';

// The browser-side research runner cannot fetch PSX / issuer / search sites
// directly (they don't send CORS headers), so this authenticated route
// fetches on its behalf — the same reason the old Mac helper used curl
// server-side instead of a browser. It is the one SSRF-sensitive surface
// this feature adds: 'search' mode is locked to a fixed credible-source
// allow-list, 'report' mode allows an arbitrary http(s) URL (mirroring the
// issuer investor-relations crawl the helper already did — plenty of
// smaller PSX issuers still run plain http) but rejects private/loopback/
// link-local hosts regardless of scheme.
const REPORT_BYTES_LIMIT = 40 * 1024 * 1024;
const TEXT_BYTES_LIMIT = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function checkAllowed(url: URL, mode: 'report' | 'search') {
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw Error('Only http/https URLs can be fetched.');
  if (isPrivateOrLocalHost(url.hostname)) throw Error('This host cannot be fetched.');
  if (mode === 'search' && url.hostname !== 'www.bing.com' && !credibleResearchHost(url.hostname))
    throw Error('This host is not on the credible-source list.');
}

// redirect: 'manual' + re-validating every hop closes an otherwise-open
// bypass: an allowed URL (even a credible-allowlist host in 'search' mode)
// could redirect anywhere, including a private/loopback address, and a
// naive redirect:'follow' would land there without ever checking the final
// host against the allowlist/private-host rules above.
async function fetchValidated(start: URL, mode: 'report' | 'search') {
  let target = start;
  for (let hop = 0; ; hop++) {
    checkAllowed(target, mode);
    const upstream = await fetch(target.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 PSX Research Runner/1.0' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      if (hop >= MAX_REDIRECTS) throw Error('Too many redirects.');
      const location = upstream.headers.get('location');
      if (!location) throw Error('Redirected without a location.');
      target = new URL(location, target);
      continue;
    }
    return { upstream, finalUrl: target };
  }
}

export async function POST(req: Request) {
  try {
    await identity(req, true);
    const body = (await req.json()) as { url?: string; mode?: 'report' | 'search' };
    const mode = body.mode === 'search' ? 'search' : 'report';
    let target: URL;
    try {
      target = new URL(String(body.url || ''));
    } catch {
      throw Error('A valid URL is required.');
    }
    const { upstream, finalUrl } = await fetchValidated(target, mode);
    if (!upstream.ok) throw Error(`${upstream.status} from ${finalUrl.hostname}`);
    const contentType = upstream.headers.get('content-type') || '';
    const isPdf = contentType.includes('application/pdf') || /\.pdf(?:$|\?)/i.test(finalUrl.pathname);
    const limit = isPdf ? REPORT_BYTES_LIMIT : TEXT_BYTES_LIMIT;
    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > limit) throw Error('The response was too large.');
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Proxy-Final-Url': finalUrl.href,
        'X-Proxy-Content-Type': contentType,
      },
    });
  } catch (error) {
    return failure(error);
  }
}
