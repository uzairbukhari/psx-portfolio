import { seedTarget } from '../scripts/seed-test-account.mjs';

// Resets the fictional account to the full known seed before every run (aborts unless signed in as that account).
export default async function globalSetup() {
  const { target, result } = await seedTarget(process.env.E2E_TARGET === 'staging' ? 'staging' : 'local');
  console.log(`[e2e] seeded ${target.url}: ${result.portfolios.map((p) => p.name).join(', ')}`);
}
