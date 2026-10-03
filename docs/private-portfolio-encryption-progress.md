# Private portfolio encryption: progress

Branch `claude/project-thread-vqrrkz`. Results below are what actually ran in this session. Nothing was deployed and
no live data was deleted.

## Built

- [x] Crypto core (`lib/vault-crypto.ts`): AES-256-GCM, random 256-bit data key, Argon2id (64 MiB, t=3, p=1, 128-bit
  salt, 32-byte output) password wrapper, separate recovery-key wrapper (`SIPW-` + Crockford base32 + checksum),
  deterministic AAD (purpose, version, vault id, key version, revision).
- [x] Separate private D1 (`VAULT_DB`, `drizzle-vault/`), `/api/vault`, `/api/v2/portfolio`; `/api/portfolio` returns 426.
- [x] Shared client (`lib/vault-client.ts`): setup (upload only after recovery-key confirmation), unlock, recover,
  change password, replace recovery key, save with revision conflicts, encrypted backup, lock zeroes the key,
  stale async work guarded by an epoch.
- [x] Web: vault gate, security settings, encrypted backup and restore, public data overlay.
- [x] Server off private data: market/quotes/dividends/face-values routes take client-named tickers; research routes no
  longer read portfolios; AI review removed; Monthly Picks computed on the device (quant ranking, no AI);
  `lib/recommendation-service.ts`, the run state machine and `PICKS_BACKGROUND` deleted.
- [x] Background features: scrapers use public tracked tickers; quote-refresh Worker has no private binding; push is
  one generic "PSX market update" per device token.
- [x] Account deletion removes the vault; "clear my data" saves a blank encrypted ledger then removes leftover rows.
- [x] Mobile: vault gate and screens (setup, recovery key with share, unlock, recover, erase), lock after 60 s in the
  background, privacy cover when inactive, encrypted on-disk cache (hashed file name; legacy plaintext cache purged),
  local Monthly Picks, encrypted backup by default, confirm-gated readable export, Lock now, HTTPS-only API URL.
- [x] Reset tooling: `scripts/reset-legacy-private-data.mjs` (dry run default, explicit database id, target must match,
  confirmation to execute, counts only). Runbook: `docs/private-portfolio-release-runbook.md`.
- [x] `deploy.yml` fails closed while the production `VAULT_DB` id is the placeholder.

## Verified (actual runs)

| Check | Result |
| --- | --- |
| `node --test 'tests/*.test.mjs'` | 644 tests, 643 pass, 0 fail, 1 skipped (the AHL real-PDF test, needs `AHL_LOCAL_PDF`) |
| `npx tsc --noEmit` (root) | clean |
| `cd mobile && npm run typecheck` | clean |
| `cd mobile && npm test` | 145 pass, 0 fail |
| `npm run build` | completes |
| Argon2id vs RFC 9106 test vector | passes |
| AES-GCM interop: WebCrypto (web) vs noble (Hermes path), both directions, `mobile/src/vault/vault.test.ts` | passes |
| Privacy boundary tests (`tests/privacy-boundary.test.mjs`): private fields never reach server routes, scrapers, push | pass |
| Reset tool: refuses missing id, wrong target, missing confirmation; never lists public tables | pass (`tests/reset-legacy-private-data.test.mjs`) |

`npm run lint` still reports many errors that predate this work (shadcn components, `FormEvent` deprecations,
react-compiler warnings); lint is not part of CI. A few in files touched here were fixed (unused imports, an unused
test variable). Others in new files (`app/vault-gate.tsx` react-compiler notes, a GET `body: undefined` option in
`app/vault-transport.ts`) remain.

## Decisions and deviations from the brief

- No AI ranking and no AI review: any provider call would need holdings or amounts, which the strict-privacy decision
  forbids. Monthly Picks is the deterministic quant score plus local sizing.
- `monthlyPicksRuns` lives inside the encrypted portfolio (newest 12), so history follows the user across devices.
- Scrapers track tickers clients have already named (quotes, facts, history, lookups) instead of tickers users hold.
- Mobile has Lock now, backup and delete account. Change password and replace recovery key are web-only for now.
- Staging seed writes a fictional plain ledger file to import through the app; it no longer writes a portfolio row.

## Not verified (needs a device, an environment or the owner)

- Argon2id (64 MiB, t=3) time on Hermes on a real phone. It is pure JS; the unit tests run it in Node only. Low-end
  Android may take several seconds. Measure on the staging build before shipping.
- `expo-crypto` secure randomness on a device, and the whole mobile vault flow on iOS and Android. It needs a new native
  build. No EAS build was spent.
- `vinext` production start, browser vault flow end to end on staging, PDF import under `npm run start`.
- Cloudflare behaviour: real `VAULT_DB` creation, the deploy guard, D1 Time Travel retention windows.
- Biometric lock and the privacy cover on a device.
- Whether Workers Logs/Logpush captured plaintext while the old endpoint was live.

## Security limitations

- The server and an attacker with the database see ciphertext, sizes, revisions, timestamps, the user's email, and the
  tickers a client asks public data for. Ticker lookups reveal interest in a company, not quantities.
- Lost password and recovery key means unrecoverable data, by design.
- A compromised device or browser with an unlocked vault sees everything. The web app trusts the JS the Worker serves.
- Argon2id parameters are fixed in the encoding; weak vault passwords remain weak.
- Anyone who obtains an encrypted backup can attack the password offline.

## Remaining release actions (owner)

1. Tag `pre-private-vault` on `main`; review the PR; check the staging deploy and rehearse (runbook section 1).
2. Create the production vault DB (`scripts/ensure-vault-db.mjs --env production --create`) and commit the id.
3. Merge to deploy production, then dry-run, then execute the legacy reset (runbook sections 3 and 4).
4. Handle Time Travel, plaintext copies and provider-held data (runbook section 4).
5. Build the staging Android app with `expo-crypto`, measure unlock time, then production builds.
6. Remove obsolete variables noted in runbook section 7.
