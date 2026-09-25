# PSX Portfolio & SIP

Multi-user investment ledger with D1 persistence, official PSX quote refresh (manual and automatic twice-daily), and sourced Monthly Picks research. Any Google account can sign in; each account gets its own fully isolated portfolio, starting empty. (The original owner's account was seeded from a private CDC statement before this app became multi-user — that seed data is not applied to new accounts.)

## User workflow

1. Sign in with Google. New accounts start with an empty ledger — add holdings via recorded purchases or an imported backup.
2. Record actual purchases (ticker, date, integer shares, price, fees, optional SIP month). Correct an opening entry to add a known average cost. Corrections void the prior entry, retaining its audit record.
3. PSX prices refresh automatically at 12:00 and 16:00 PKT on weekdays (see `workers/quote-refresh/`); refresh on demand with the "Refresh PSX prices" button, or enter a verified manual quote and date. Every held company and target company needs a price for a complete SIP calculation.
4. In Monthly Picks, select up to 15 saved companies, choose a month and enter fresh investment money. The shortlist is treated as user-approved eligibility.
5. Request sourced 60–90 day research. It ranks up to five companies, proposes a rupee split, and estimates affordable whole shares from dated PSX quotes. It never records trades automatically.
7. Export a full portfolio backup periodically. This schema is distinct from the company-research dashboard's JSON import; restoring replaces only this ledger and requires confirmation.

## Calculation boundaries

Weighted average cost includes purchase fees. Sales remove shares at the average cost immediately before the sale; missing opening cost keeps cost and return unknown until that position is fully closed or corrected. Same-day entries use ledger order, with opening balances first. Earlier transactions cannot be added before an active opening snapshot; void/correct that snapshot before importing full historical transactions to avoid double-counting.

Market values exclude cash, dividends and unrecorded corporate actions. Returns are unrealised changes in the remaining holdings, not a total-return or tax report. The estimate allocates integer shares, rounds fee-inclusive unit costs upward to the paisa and remains within the remaining monthly budget. New allocation gaps are capped using 20% of priced holdings plus the remaining contribution. There is no recommendation to sell an existing overweight position. Targets and 183-day screening expiry are editable planning assumptions, not formal Shariah certification.

## Monthly Picks research

Uses `gpt-5-mini` in saved background stages. Shortlists are split deterministically into batches of at most five companies; each batch permits at most 12 web-search calls and 8,000 output tokens. Research records claim-level evidence for financial trajectory, valuation, developments, and risk. One bounded targeted repair pass runs automatically for material gaps, followed by a structured comparison. A repair stopped specifically by its output ceiling can be explicitly resumed from saved evidence. The final comparison is reserved before research and the total of settled costs plus outstanding reservations may never exceed $1.

A missing or mismatched citation leaves that company unassessed rather than giving it a negative outlook. A `completed_partial` result can recommend from the sufficiently researched subset while listing excluded candidates and their specific evidence gaps. Unsupported picks are removed and their allocation remains cash. Supported picks can show share estimates when a current dated price is available. Source provenance is not a guarantee that a claim or forecast is correct.

`recommendation_attempts` retains batch identity, provider IDs, raw outputs, source metadata, failures, cost reservations and actual usage. The recommendation row stores an immutable versioned run snapshot. Duplicate polling uses deterministic usage IDs. Earlier workflow results remain readable but are never reused as version-2 evidence. A submission timeout becomes `needs_attention`, preserving data and budget. No API key or portfolio holdings, trades, targets or Research Desk dossiers enter these requests.

Production for this checkout is `https://psx-portfolio-sip.suzairbukhari.workers.dev`. The older ChatGPT Sites publication is a separate deployment, not proof that this Worker has been updated. Apply migrations through `0011_gray_zemo.sql` before deploying this version.

## Development & deployment

- Node >=22.13; install with npm and preserve package-lock.json.
- Before the first local run, execute `npm run db:migrate:local` once to create the local D1 tables. Then `npm run dev` starts the Vinext preview.
- Local sign-in bypass: put `DEV_AUTH_EMAIL=dev@localhost` (optionally `DEV_AUTH_NAME`) in a git-ignored `.dev.vars` and `npm run dev` treats every request as that user, skipping Google OAuth — no `GOOGLE_CLIENT_SECRET`/`SESSION_SECRET` needed locally. `lib/auth.ts` only honours it when the request's `Host` is `localhost`, `127.0.0.1` or `[::1]`, and `.dev.vars` is never deployed, so the deployed Worker still requires a real signed session. Change the email to switch which local portfolio row you load.
- `node --test 'tests/*.test.mjs'` runs all tests: portfolio cost accounting, sales, missing data, dates, monthly budgets, allocation limits and AI weights (`tests/portfolio.test.mjs`), plus session cookie signing/verification (`tests/session.test.mjs`).
- `npx tsc --noEmit` checks types; `npm run build` builds the Cloudflare Worker.
- D1 schema is in `db/schema.ts`; generate append-only migrations with `npm run db:generate`. Apply local migrations with `--local --persist-to .wrangler/state`; apply them to your own deployed database with `wrangler d1 migrations apply DB --remote`.
- This is a standalone Cloudflare Worker deployment (`wrangler deploy`) in your own Cloudflare account — no external hosting platform is involved. Secrets (`OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) are set with `wrangler secret put <NAME>`, never committed. Non-secret config (`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) lives in `wrangler.jsonc`'s `vars`.
- API requests require a signed-in Google account (any verified account by default; set `ALLOWED_EMAILS` to a comma-separated list to restrict sign-in again); writes also require same-origin requests. Per-user data is isolated with revision checks to reject concurrent stale saves.
- The automatic PSX refresh runs as a second, independent Cloudflare Worker (`workers/quote-refresh/`) on its own Cron Trigger schedule, sharing the same D1 database. Deploy it once with `npm run quote-refresh:deploy`; it writes to a shared `quote_refreshes` cache table that every user's portfolio read merges in, so it never touches per-user save/revision state.

## Validation

Calculation tests and type/build checks are required. Validate local saving, reload, stale-write rejection, PSX quote refresh, recommendation polling, saved history, and cached-result reuse.
