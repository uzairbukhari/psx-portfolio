# PSX Portfolio & SIP

Multi-user investment ledger with D1 persistence, official PSX quote refresh (manual and automatic twice-daily), and a low-cost GPT-5 nano review. Any Google account can sign in; each account gets its own fully isolated portfolio, starting empty. (The original owner's account was seeded from a private CDC statement before this app became multi-user — that seed data is not applied to new accounts.)

## User workflow

1. Sign in with Google. New accounts start with an empty ledger — add holdings via recorded purchases or an imported backup.
2. Record actual purchases (ticker, date, integer shares, price, fees, optional SIP month). Correct an opening entry to add a known average cost. Corrections void the prior entry, retaining its audit record.
3. PSX prices refresh automatically at 12:00 and 16:00 PKT on weekdays (see `workers/quote-refresh/`); refresh on demand with the "Refresh PSX prices" button, or enter a verified manual quote and date. Every held company and target company needs a price for a complete SIP calculation.
4. Set a monthly budget, fee estimate, company targets and screening dates. Target weights total 100%. Contributions already recorded against the SIP month reduce its remaining budget. Sales do not reset this contribution budget.
5. Inspect the whole-share plan. It fills target gaps using new contributions and excludes paused, overdue-screen and overweight names. Unspent cash remains unallocated; plans never create trades automatically.
6. Request an AI review if helpful, inspect the reasoning and explicitly apply its target weights. AI cannot change purchase eligibility or record trades.
7. Export a full portfolio backup periodically. This schema is distinct from the company-research dashboard's JSON import; restoring replaces only this ledger and requires confirmation.

## Calculation boundaries

Weighted average cost includes purchase fees. Sales remove shares at the average cost immediately before the sale; missing opening cost keeps cost and return unknown until that position is fully closed or corrected. Same-day entries use ledger order, with opening balances first. Earlier transactions cannot be added before an active opening snapshot; void/correct that snapshot before importing full historical transactions to avoid double-counting.

Market values exclude cash, dividends and unrecorded corporate actions. Returns are unrealised changes in the remaining holdings, not a total-return or tax report. The estimate allocates integer shares, rounds fee-inclusive unit costs upward to the paisa and remains within the remaining monthly budget. New allocation gaps are capped using 20% of priced holdings plus the remaining contribution. There is no recommendation to sell an existing overweight position. Targets and 183-day screening expiry are editable planning assumptions, not formal Shariah certification.

## Low-cost AI

Uses `gpt-5-nano` to select between validated current-target and equal-weight profiles and explain its choice. This bounded comparison avoids unreliable model-generated arithmetic. It uses minimal reasoning, an 1,800-token total output ceiling, compact current holdings and a short prior-research summary. No paid tools, web search, automatic retries or background runs. Unchanged same-day portfolio/month reviews are cached in D1; repeated reads make no OpenAI call. Token usage and estimated USD cost are stored with successful reviews. Price assumptions verified 10 September 2026: $0.05/M input, $0.005/M cached input, $0.40/M output, including reasoning. The estimate is not an account balance or billing guarantee. No silent upgrade to a pricier model.

Only previous research and explicitly supplied quote data are available to this low-cost review; it cannot claim to have read new filings. For deeper research, export the portfolio prompt to the company's existing ChatGPT conversation and import reviewed target weights.

## Development & deployment

- Node >=22.13; install with npm and preserve package-lock.json.
- Before the first local run, execute `npm run db:migrate:local` once to create the local D1 tables. Then `npm run dev` starts the Vinext preview.
- `node --test 'tests/*.test.mjs'` runs all tests: portfolio cost accounting, sales, missing data, dates, monthly budgets, allocation limits and AI weights (`tests/portfolio.test.mjs`), plus session cookie signing/verification (`tests/session.test.mjs`).
- `npx tsc --noEmit` checks types; `npm run build` builds the Cloudflare Worker.
- D1 schema is in `db/schema.ts`; generate append-only migrations with `npm run db:generate`. Apply local migrations with `--local --persist-to .wrangler/state`; apply them to your own deployed database with `wrangler d1 migrations apply DB --remote`.
- This is a standalone Cloudflare Worker deployment (`wrangler deploy`) in your own Cloudflare account — no external hosting platform is involved. Secrets (`OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) are set with `wrangler secret put <NAME>`, never committed. Non-secret config (`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) lives in `wrangler.jsonc`'s `vars`.
- API requests require a signed-in Google account (any verified account by default; set `ALLOWED_EMAILS` to a comma-separated list to restrict sign-in again); writes also require same-origin requests. Per-user data is isolated with revision checks to reject concurrent stale saves.
- The automatic PSX refresh runs as a second, independent Cloudflare Worker (`workers/quote-refresh/`) on its own Cron Trigger schedule, sharing the same D1 database. Deploy it once with `npm run quote-refresh:deploy`; it writes to a shared `quote_refreshes` cache table that every user's portfolio read merges in, so it never touches per-user save/revision state.

## Validation

Calculation tests and type/build checks are required. Validate local saving, reload, stale-write rejection, PSX quote refresh and the AI response/cache path. Browser visual QA was not requested. WebMCP read tool is feature-detected; no supported WebMCP execution context was available, so its browser contract remains unverified.
