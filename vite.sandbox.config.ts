// A second dev server for automated testing: same app, but its own empty local databases (.wrangler/sandbox) and
// signed in as the fictional test account, so the real local data behind `npm run dev` is never touched.
// Created by `npm run sandbox:setup`; started by `npm run sandbox:dev`.
import path from 'node:path';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export const SANDBOX_PORT = 5191;
const sandbox = path.resolve(process.cwd(), '.wrangler/sandbox');

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= path.join(sandbox, 'logs');
  process.env.MINIFLARE_REGISTRY_PATH ??= path.join(sandbox, 'registry');
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: { host: '127.0.0.1', port: SANDBOX_PORT, strictPort: true },
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        configPath: path.join(sandbox, 'wrangler.json'),
        persistState: { path: path.join(sandbox, 'state') },
        config: { main: 'vinext/server/fetch-handler' },
      }),
    ],
  };
});
