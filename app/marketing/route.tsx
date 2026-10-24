// Shared by the public marketing routes: on the app host these paths are not part of the app, so they go to the marketing host.
import { redirect } from 'next/navigation';
import { hostConfig } from '@/lib/hosts-server';
import { hostRole, marketingOrigin } from '@/lib/hosts';
import { headers } from 'next/headers';

export async function marketingOnly(path: string): Promise<void> {
  const cfg = hostConfig();
  const host = (await headers()).get('host');
  if (hostRole(host, cfg) === 'app') redirect(`${marketingOrigin(cfg)}${path}`);
}
