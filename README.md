# PSX Portfolio & SIP

Private investment ledger with D1 persistence, official PSX quote refresh, and a low-cost GPT-5 nano review. Keep Sites owner-only: the initial account is populated from the user's private CDC statement.

## User workflow

1. Open Holdings to review the 21 opening balances from 9 September 2026. Opening cost is unknown until supplied; no profit is invented. Initial quote snapshot is from official PSX pages on 10 September 2026, with timestamps.
2. Record actual purchases (ticker, date, integer shares, price, fees, optional SIP month). Correct an opening entry to add a known average cost. Corrections void the prior entry, retaining its audit record.
3. Refresh PSX prices or enter a verified manual quote and date. Every held company and target company needs a price for a complete SIP calculation.
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
- Before the first local run, execute `npm run db:migrate:local` once to create the local D1 tables. Then `npm run dev` starts the Vinext preview. Local sign-in uses the starter's `/signin-with-chatgpt` flow.
- `node --test tests/portfolio.test.mjs` checks cost accounting, sales, missing data, dates, monthly budgets, allocation limits and AI weights.
- `npx tsc --noEmit` checks types; `npm run build` builds the Cloudflare Worker.
- D1 schema is in `db/schema.ts`; generate append-only migrations with `npm run db:generate`. Apply local migrations using Wrangler with `--local --persist-to .wrangler/state`; production migrations are managed by Sites deployment.
- `.env.local` is ignored; `OPENAI_API_KEY` is a server-side secret. Never put a key in a public variable, source file, hosting manifest or bundle. Hosted secrets are configured through Sites.
- API requests require ChatGPT identity and writes require same-origin requests. Per-user data is isolated with revision checks to reject concurrent stale saves.

## Validation

Calculation tests and type/build checks are required. Validate local saving, reload, stale-write rejection, PSX quote refresh and the AI response/cache path. Browser visual QA was not requested. WebMCP read tool is feature-detected; no supported WebMCP execution context was available, so its browser contract remains unverified.
