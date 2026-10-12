---
name: test-app
description: Test a change end to end on the local sandbox and/or staging as the fictional test account (Playwright suite, seeding, Chrome exploration). Use when asked to test, verify or smoke-test the app, "test on local/staging", or after changing UI or portfolio features.
---

# Test the app as the fictional test account

Read `docs/testing.md` first. Rules:

1. **Never use the real dev server (`npm run dev`, port 5173) for writes or seeding.** Real localhost data is production data.
   Use the sandbox (`npm run sandbox:dev`, port 5191) or staging.
2. Local: `npm run sandbox:setup` (first time), start `npm run sandbox:dev` in the background, then `npm run e2e:local`.
   Staging: `npm run e2e:staging` (needs `TEST_LOGIN_SECRET` in the environment or `.env.test.local`; ask the user if missing).
3. Both reseed the test vault first. For manual exploration with Claude in Chrome: sign in (staging: `/api/auth/test-login`),
   unlock with the password in `lib/test-account.ts`, tick "Keep me unlocked in this tab".
4. After changing behaviour, add or update a spec in `e2e/` and extend `lib/test-seed/account.ts` if a new kind of record exists
   (`tests/test-seed.test.mjs` enforces enum coverage). Run `node --test 'tests/*.test.mjs'` and `npx tsc --noEmit` too.
5. Report real results: list failing specs with the error, never claim a pass without running the suite.
