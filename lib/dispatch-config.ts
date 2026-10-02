import { env } from 'cloudflare:workers';
import type { DispatchConfig } from './github-dispatch.ts';

/** GitHub dispatch settings of the Worker serving this request (see `dispatchBlockedReason`). */
export const dispatchConfig = (): DispatchConfig => ({
  token: env.GITHUB_DISPATCH_TOKEN,
  repo: env.GITHUB_REPO,
  appEnv: env.APP_ENV,
});
