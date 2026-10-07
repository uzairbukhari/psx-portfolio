import { env } from 'cloudflare:workers';

/**
 * Cloudflare Web Analytics (cookieless page views and page speed) for the public, signed-out pages only: landing,
 * privacy and terms. Never rendered inside the signed-in app. Off until CF_WEB_ANALYTICS_TOKEN is set.
 */
export function CfBeacon() {
  const token = env.CF_WEB_ANALYTICS_TOKEN;
  if (!token) return null;
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
