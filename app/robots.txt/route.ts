import { hostConfig } from '@/lib/hosts-server';
import { hostRole, robotsTxt } from '@/lib/hosts';

// Depends on the host: the app host asks search engines to stay out, the marketing host (and a single-host setup) lists what to index.
export async function GET(req: Request) {
  const cfg = hostConfig();
  const role = hostRole(new URL(req.url).host, cfg);
  return new Response(robotsTxt(role, cfg), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
