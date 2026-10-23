import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { hostRole, type HostConfig, type HostRole } from './hosts.ts';

export function hostConfig(): HostConfig {
  return { marketingHost: env.MARKETING_HOST, appHost: env.APP_HOST };
}

/** Which site this request is for. Reads only the Host header and two vars: no database, no session. */
export async function currentHostRole(): Promise<HostRole> {
  const h = await headers();
  return hostRole(h.get('host'), hostConfig());
}
