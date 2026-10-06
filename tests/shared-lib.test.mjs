import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// These modules are bundled into the native apps (mobile/ reads ../lib), so they
// must stay free of the Workers runtime, Next.js and DOM-only imports.
const SHARED = [
  'api-types',
  'portfolio',
  'portfolio-account',
  'account-overview',
  'performance',
  'portfolio-reports',
  'allocation',
  'psx-calendar',
  'psx-payouts',
  'notifications',
  'notification-actions',
  'dividend-sync',
  'targets',
  'monthly-picks-flow',
  'price-history',
  'user-error',
  'ahl-import',
  'cdc-import',
  'monthly-picks',
  'monthly-picks-allocation',
  'monthly-picks-progress',
  'market-meta',
  'api-validate',
  'portfolio-counts',
  'security-catalog',
  'face-values',
  'ipo-offers',
  'import-splits',
  'quote-job-types',
  'quote-refresh-client',
  'import-refresh',
  'picks-local',
  'picks-run',
  'public-analysis-types',
  'monthly-picks-ai',
  'company-facts',
  'market-watch',
  'vault-crypto',
  'vault-client',
  'vault-backup',
  'portfolio-view',
  'public-data-client',
  'psx-market',
  'psx-quotes',
  'psx-fetch',
  'company-enrichment',
  'company-directory',
  'quote-merge',
];
const FORBIDDEN = /from\s+['"](cloudflare:|next\/|@\/|react-dom|node:)/;

for (const name of SHARED) {
  test(`lib/${name}.ts stays portable to the mobile app`, () => {
    const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
    for (const line of source.split('\n')) {
      assert.ok(!FORBIDDEN.test(line), `forbidden import in lib/${name}.ts: ${line.trim()}`);
      const local = /from\s+['"](\.[^'"]+)['"]/.exec(line);
      if (local) {
        const target = local[1].replace(/^\.\//, '').replace(/\.ts$/, '');
        assert.ok(SHARED.includes(target) || ['psx-payouts', 'psx-calendar'].includes(target), `lib/${name}.ts imports lib/${target}, which is not in the shared list`);
      }
    }
  });
}
