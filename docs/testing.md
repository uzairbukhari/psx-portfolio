# Automated testing on local and staging

Claude (or you) can test every change end to end, on both environments, as one **fictional test account**:
`claude-test@sipwise.test`, vault password `fictional-test-vault-passphrase-2026` (both in `lib/test-account.ts`).
The portfolio stays end-to-end encrypted: the seeder builds the vault with the real client code, so the server only
ever sees ciphertext.

**Never test against your real account.** `npm run dev` (port 5173) is signed in as the real owner; the tooling below
refuses to run against it and always checks `GET /api/me` returns the test account before writing anything.

## What is seeded

`lib/test-seed/account.ts` builds four portfolios (the maximum), all fictional, dated relative to today:

| Portfolio | Contents |
| --- | --- |
| **AHL Core** (filer) | 14 companies across 8 sectors; opening (known and unknown cost), buy, sell, bonus adjustment, voided, AHL / broker / IPO-sourced trades with provenance, a stock split, fully sold company; dividends of every kind (manual, CDC import, auto expected / received / estimated date / date unknown, voided, percent-of-face-value); budgets, Monthly Picks list, notifications (all kinds, read / unread / cleared), research dossiers (every status), AI review, broker formats |
| **Finqalab** (non-filer) | Finqalab-imported trades overlapping AHL Core's tickers, a fully sold company, a manual trade, non-filer dividend |
| **Savings & Gold** | Gold (22k coins incl. unknown-cost opening, 24k bar, voided entry, sale), silver, a Pak-Qatar plan (rule with a skipped month, load, redemption, statement values), a closed plan, three mutual funds (reinvest with auto payout, cash payout, closed; manual NAV; recurring rule) |
| **Empty** (locked) | Empty-state and lock behaviour |

`lib/test-seed/universe.ts` lists the companies (real PSX tickers), the fictional funds (ids `990001`-`990003`) and metal
rates. `tests/test-seed.test.mjs` fails when an enum value the app knows about (trade kind, dividend flavour, asset kind,
fund entry type, notification kind, ...) is not exercised by the seed. **When you add a feature, extend the seed.**

Public data: locally `lib/test-seed/public-fixtures.ts` generates deterministic synthetic quotes, a year of price
history, company facts, dividend announcements, IPO offer, fund NAVs/payouts, plan NAVs and gold/silver rates.
On staging the real scrapers fill what they can (`seed-staging.yml`), and `scripts/seed-staging-public.mjs` adds only the
gaps (fund directory and prices, the test account's `super_admin` role). AI Lab research tables are not seeded: the tab
shows its empty state, and Monthly Picks runs on the device from the seeded company facts.

## Local

```bash
npm run sandbox:setup          # once: own empty D1 databases in .wrangler/sandbox + synthetic public data
npm run sandbox:dev            # http://127.0.0.1:5191, always signed in as the test account (separate from npm run dev)
npm run e2e:local              # reseeds the vault, then runs the Playwright suite
node scripts/seed-test-account.mjs --target=local   # reseed only
npm run sandbox:reset          # wipe the sandbox and start clean
```

The sandbox never touches `.wrangler/state`, the real local databases.

## Staging

CI runs the full suite on the local sandbox (`e2e-sandbox` job in `deploy-staging.yml`, no Cloudflare reads) and only the `@smoke` tests on staging (`npm run e2e:smoke`), because staging shares the account-wide D1 daily limit with production. Tag a test `@smoke` in its title only if it must run against real staging.

One-time setup:

1. Pick a long random string and store it as the **`TEST_LOGIN_SECRET`** secret of the GitHub `staging` environment.
   Every staging deploy copies it to the Worker (`wrangler secret put TEST_LOGIN_SECRET --env staging`), or run that
   command yourself once.
2. Put the same value in a git-ignored `.env.test.local` (`TEST_LOGIN_SECRET=...`) to run things from your machine.

`/api/auth/test-login` only exists when `APP_ENV=staging` **and** the secret is set (404 elsewhere, never on
production), only ever signs in the test account, is rate limited and same-origin. Open it in a browser for a form.

```bash
node scripts/seed-test-account.mjs --target=staging   # reset the staging vault to the full seed
npm run e2e:staging                                   # seed + smoke suite against https://psx-portfolio-sip-staging.uahmed.workers.dev
```

CI: `deploy-staging.yml` runs the `e2e` job after every staging deploy (skipped until the secret exists). Override the
URL with `E2E_BASE_URL`. Staging prices are real and move, so specs assert exact numbers on local only.

## Exploring by hand (Claude in Chrome)

1. Local: open `http://127.0.0.1:5191`. Staging: open `https://psx-portfolio-sip-staging.uahmed.workers.dev/api/auth/test-login`, enter the secret.
2. At the vault gate type the vault password and tick **Keep me unlocked in this tab** (reloads then stay unlocked).
3. Use the header switcher: All, AHL Core, Finqalab, Savings & Gold, Empty.

## Adding a test

Specs live in `e2e/` (`fixtures.ts` gives an unlocked `app` page; one unlock is shared by the whole run). The write test
is `zz-write.spec.ts` so it runs last; every run reseeds, so nothing leaks between runs.
