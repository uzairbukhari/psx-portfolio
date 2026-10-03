# Private portfolio encryption: release runbook

Owner-run cutover for the end-to-end encrypted portfolio. Nothing in this document has been executed. Every step that
deletes data or deploys production is a human action; the tools below default to a dry run.

Background: portfolios, budgets, notes, shortlists and Monthly Picks results are encrypted on the device (AES-256-GCM,
key wrapped by an Argon2id vault password and by a recovery key). The server stores ciphertext in a separate D1
database (`VAULT_DB`). Fresh start: nothing is migrated from the old plaintext `portfolios` table. See
`docs/private-portfolio-encryption-progress.md` for what was built and verified.

## 0. Rollback point

1. Tag or branch `main` before merging: GitHub `pre-private-vault` (the repo convention for risky merges).
2. Merging to `main` deploys production, but `deploy.yml` fails closed (warns and deploys nothing) while the
   `VAULT_DB` id in `wrangler.jsonc` is still all zeros. So merging is safe until step 3 is done.

## 1. Rehearse on staging first

1. Every same-repo PR deploys staging. `deploy-staging.yml` runs `scripts/ensure-vault-db.mjs --env staging --create`, which
   creates `psx_portfolio_sip_staging_vault` once and patches its id.
2. Open https://psx-portfolio-sip-staging.suzairbukhari.workers.dev on the web: create the vault, save the recovery key,
   add a trade, lock, unlock, reload, sign in on a second browser and unlock there, change the password, restore an
   encrypted backup, run Monthly Picks, delete the account.
3. Rehearse the deletion tool against staging: `D1_DATABASE_ID=<staging id> node scripts/reset-legacy-private-data.mjs --target=staging`
   (dry run), then add `--execute --confirm=<first 8 chars of the id>`.
4. Mobile needs a NEW native build (see section 6). Do not spend an EAS build before the web rehearsal passes.

## 2. Production vault database

1. `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/ensure-vault-db.mjs --env production` (report only).
2. If missing: the same command with `--create`; it writes the real id into `wrangler.jsonc` (names are fixed, so it
   cannot pick another database). Commit that change in its own PR.
3. `deploy.yml` then migrates `DB` and `VAULT_DB` and deploys the web Worker; the quote-refresh Worker has no
   vault binding.

## 3. Cut over (the order matters)

1. Merge the PR (guard still closed). Merge the vault-id PR from step 2 only when ready to go live.
2. Production deploys. From this moment `/api/portfolio` answers `426 upgrade-required`, so an old web tab or old app
   build can no longer read or write the plaintext ledger. Old builds show "Update needed".
3. Run the dry run and read the counts:
   `D1_DATABASE_ID=f72a6264-371b-49ff-89e3-20eef1ce2b19 node scripts/reset-legacy-private-data.mjs --target=production`
4. Delete the legacy plaintext rows when satisfied:
   `… --target=production --execute --confirm=f72a6264` (add `--revoke-sessions` to sign every phone out; their push
   tokens are re-registered at next sign-in).
5. Sign in on the web, create the vault, store the recovery key somewhere that is not the same place as the password.

## 4. After deletion (deletion in D1 is not erasure everywhere)

- **D1 Time Travel** keeps point-in-time restore data (7 days on Workers Free, 30 on Paid). Plaintext rows remain
  restorable inside that window. Either wait it out, or accept it and note the date. Do not restore past the cutover.
- **Backups and copies**: any `wrangler d1 export`, downloaded JSON export or screenshot made before the cutover is a
  plaintext copy. Find and delete them. Old Expo/OS caches on phones are purged by the new app at first launch
  (`purgeLegacyPlaintextCache`); a phone that never updates keeps its old cache, so remove the old app.
- **Provider-held data**: AI review and Monthly Picks used to send holdings to OpenAI. Review that provider's data
  retention and any stored responses, and delete what the account lets you delete. The new build sends nothing private
  to any AI provider (Monthly Picks ranking is local; the AI review was removed).
- **Logs**: the code does not log request bodies, but check Cloudflare Workers Logs/Logpush for anything captured while the plaintext endpoint was live.
- **GitHub**: Actions logs from earlier scrapers listed tickers held by users. Delete old runs if that matters to you.

## 5. Rolling back

- Ciphertext-only rollback: redeploy the previous Worker only if it can read the vault. It cannot, so a rollback to the
  pre-encryption build means plaintext again for any NEW data. Prefer fixing forward. If you must roll back, the vault
  database is untouched and can be re-attached later; ciphertext is never converted back.
- The reset tool is not reversible outside Time Travel. Always dry-run, and keep the `pre-private-vault` branch.

## 6. Mobile

- Needs a new native build: it adds `expo-crypto` (secure randomness) and the vault gate. An OTA update cannot carry it.
- Do not spend one of the 15 free EAS builds per platform until the web is verified. Build staging Android first.
- Unverified on a device: Argon2id time on Hermes (pure JS, 64 MiB). If unlock is slow on a low-end phone, report the
  measured seconds; the parameters are fixed in the encoding and cannot be changed silently.

## 7. Obsolete configuration to remove after go-live

- Worker secret/vars no longer read: `AI_MONTHLY_CAP_USD`, `PICKS_BACKGROUND` (already removed from `wrangler.jsonc`).
- `OPENAI_API_KEY` is still used by the admin Research desk synthesis. Remove it only if you retire that feature.
- Nothing needs a key for private data: there is no server-side data key and no recovery-key escrow.

## 8. What the server still knows

Email, vault existence, ciphertext size and revision, timestamps, tickers the client names for public data (quotes,
company facts), and generic push tokens. It does not know holdings, trades, budgets, notes, shortlists or picks results.
A lost password AND recovery key means the data is unrecoverable by design.
