import { SITEMAP_PATHS, SITE_ORIGIN } from '@/lib/marketing-seo';
import { hostConfig } from '@/lib/hosts-server';
import { hostRole, marketingOrigin, sitemapXml } from '@/lib/hosts';

export async function GET(req: Request) {
  const cfg = hostConfig();
  const url = new URL(req.url);
  const role = hostRole(url.host, cfg);
  // The app host has nothing to index.
  const body =
    role === 'app'
      ? sitemapXml(url.origin, [])
      : sitemapXml(marketingOrigin(cfg) || SITE_ORIGIN, SITEMAP_PATHS);
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
}
