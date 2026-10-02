# Sipwise mobile design specification

Direction: **Steady Steps.** The Sipwise icon is a staircase ending in a mint dot. The app is organised the same way: one calm monthly rhythm (set a budget, buy toward targets, record, check progress), with every number saying exactly what it includes. Advanced detail (lots, tax, method notes, AI reasoning) stays one tap away rather than on the first screen.

Why this direction (Step 06):

- The audit's two P1s are trust problems (a mislabelled headline and a tab that cannot be configured). The design starts from honest numbers and a guided monthly loop, not decoration.
- Public examples converge on the same patterns: separate unrealised, realised, dividends and money put in (Wealthsimple performance insights); plot value against net deposits (Wealthsimple history chart); make the recurring contribution a target-weighted object that tops up underweight slices first (Trading 212 Pies, which is exactly what `lib/portfolio.ts#plan` already does); compare with an index only on matching cash flows and say why personal return differs (Vanguard). Sources and access dates are in `audit.md` §6.
- Both audiences are served by progressive disclosure: a newer investor sees "This month: PKR 18,000 of 25,000 invested, 2 buys suggested"; the owner can open lots, average-cost math, fees, stale-quote dates and tax estimates from the same card.
- Not chosen: a trading-app look (red/green tickers, live flashing prices) because Sipwise is a ledger and planner fed by delayed PSX data; a dashboard of many small charts because it hides what each number means.

## 1. Navigation

Four destinations in a bottom navigation bar (Material: three to five; Apple: tabs navigate, they do not perform actions), plus a header bell and a contextual Add button.

| Tab | Purpose | Contains |
|---|---|---|
| **Today** | "How am I doing and what should I do this month?" | Portfolio summary card, this-month SIP progress, next actions (stale prices, expected dividends to confirm, plan ready), market context (KSE-100), value vs money-in chart |
| **Portfolio** | Holdings and companies | Holdings list (sort, include sold), company detail, Insights (reports) segment |
| **Plan** | Monthly SIP | Budget and month, Targets mode (target-weight plan) and Monthly Picks mode (AI/quant), record suggested buys |
| **Activity** | The ledger | Month-grouped entries, filters, search, Import, corrections |
| Header bell (all tabs) | Inbox | Alerts with read/clear/history; dividend actions |
| Header avatar | More | Account, security (app lock, devices), notifications, tax status, data (export, delete account), AI usage, appearance, about, "Research desk on web" (admins) |

Add (buy / sell / dividend / split / price) is a floating or header action on Today, Portfolio, Company and Activity, opening one sheet. Research desk stays web-only. Monthly Picks lives inside Plan because it answers the same question as the target plan ("what should I buy this month?").

Novice journey: sign in → welcome (what Sipwise tracks, that data syncs with the web) → choose "Import broker history" or "Add first holding" → set monthly budget → choose companies and targets (or start from Monthly Picks) → Today shows progress.
Advanced journey: Today → Plan (targets) → Record all suggested buys (review sheet) → Activity to correct → Portfolio › Insights for tax and income.

## 2. Design system

### Colour tokens (WCAG contrast checked, see `verification.md`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | `#f5f6f2` | `#0b1210` | Screen background |
| `surface` | `#ffffff` | `#121b18` | Cards |
| `raised` | `#eef0ea` | `#1a2622` | Pressed rows, segmented control track |
| `line` | `#dfe3da` | `#26332e` | Dividers, outlines (non-text) |
| `ink` | `#13201b` | `#e8efe9` | Primary text (15.5:1 / 16.2:1) |
| `muted` | `#56635d` | `#9fb0a8` | Secondary text (≥5.8:1) |
| `primary` | `#1d4ed8` | `#7aa2ff` | Actions, links, selected state (6.7:1 on surface; white on primary 6.7:1; dark ink on dark primary 7.6:1) |
| `primarySoft` | `#e3eafc` | `#1b2a4d` | Selected chip / tonal button bg (primary text on it ≥5.6:1) |
| `gain` | `#0a7350` | `#3fd6a0` | Positive change text (5.9:1 / 9.5:1) |
| `loss` | `#b42318` | `#ff8a80` | Negative change text (6.6:1 / 7.7:1) |
| `warn` | `#8a5a00` on `#fbf0d9` | `#f0c46a` on `#33280f` | Stale/incomplete notices (5.2:1 / 8.8:1) |
| `brandMint` | `#22e0a0` | `#22e0a0` | Decorative only: the "step reached" dot, progress complete. Never text. |

Rules: gain/loss are always signed (+/−) and paired with an arrow glyph; colour is never the only signal. Status chips use icon + word ("Stale price", "Expected", "Received").

### Type

System fonts (Roboto / SF Pro) so Dynamic Type and Android font scale work without bundling. Numbers use tabular figures.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| Display number | 34 / 40 | 700 | One headline figure per screen |
| Title | 22 / 28 | 700 | Screen titles |
| Headline | 17 / 22 | 600 | Card titles, row titles |
| Body | 15 / 22 | 400 | Text |
| Number | 15 / 20 tabular | 600 | Amounts in rows |
| Caption | 13 / 18 | 400 | Secondary lines, dates |
| Overline | 12 / 16 | 600, +0.4 tracking | Section labels (sentence case, not all caps) |

Text wraps rather than shrinks: remove `adjustsFontSizeToFit`; rows grow to two lines at large font scales; the display number may drop to Title size above 1.6× scale.

### Space, shape, targets, motion

- 4-pt grid; screen gutter 16; card padding 16; gap between cards 12.
- Radius: cards 16, controls 12, chips full.
- Every interactive element at least 48×48 dp (Android) / 44×44 pt (iOS) including hit slop; row height ≥ 56.
- Motion: 150–200 ms ease-out for sheets and segment changes; progress bars animate once on load. With Reduce Motion / "Remove animations" on, no animation beyond opacity.
- Icons: 24-px stroke set already in `src/ui/Icon.tsx`, extended with bell, filter, search, calendar-check.

### Charts

- Always a text summary as the accessibility label and visible above the chart ("Up PKR 42,300 (+8.1%) over 1 year").
- Value chart draws two lines: value and money in (net invested), so growth is the gap between them.
- Range control as a segmented control (1M, 6M, 1Y, All), 48-dp targets.
- Benchmark line only when index history exists for the whole range; legend says "KSE-100 price index (dividends excluded), same cash flows".
- No chart when fewer than two points; show the reason instead.

### Number language

| Say | Instead of | Meaning |
|---|---|---|
| Market value of priced holdings | Portfolio value (when incomplete) | Σ shares × last saved price |
| Cost of current holdings | Invested | Remaining average cost, fees included |
| Unrealised gain | all time / Return | value − cost on current holdings |
| Realised gain | — | sales at average cost, after fees |
| Dividends received | — | `status: received`, gross and net |
| Total return | — | unrealised + realised + dividends received (before tax; after-tax shown in detail) |
| Money in | — | Σ buys + fees − Σ sale proceeds |
| Bought this month | Invested (SIP) | buys tagged to or dated in the month |
| Expected dividend | Dividend (expected) | announced, not yet confirmed received |

Every figure that depends on prices shows the oldest quote date it used when that date is not today's trading day ("Prices as of 30 Sep").

## 3. Core screens

Each screen lists purpose, hierarchy (top to bottom), actions, data, and states. "Data" maps to existing code or names a genuine dependency.

### 3.1 Today

- Purpose: answer "how am I doing" and "what's next" in one glance.
- Hierarchy: header (greeting, bell with count, avatar) → **Summary card**: market value (display), unrealised gain (signed, arrow), cost of current holdings; "See total return" expands realised, dividends received, total return; completeness line (e.g. "1 holding needs a price") → **This month** card: budget, bought this month, remaining, progress bar with step dots per buy, primary button "Plan this month's buys" → **Next actions** list (max 3: confirm expected dividend, refresh 2 stale prices, set targets) → **Value vs money in** chart (collapsed on small screens) → **Market** card (KSE-100 level, change, session state, "delayed").
- Actions: Add, refresh (pull), open Plan, open item from next actions.
- Data: `holdings`, new shared `portfolioSummary` (FIN-002), `taxSummary`/`portfolioReport` for realised and dividends, `plan()` for this month, `portfolioValueSeries` (exists in `lib/price-history.ts`, used by web) for the chart, `/api/market-summary`. Money-in line: new pure function from ledger. Benchmark: **new data** (daily KSE-100 history).
- States: first use (welcome + import/add), loading (skeleton cards with shimmer off when reduced motion), offline (banner "Offline · showing saved copy from 14:05", actions that write are disabled with reason), stale prices (warn chip on summary), error (card-level retry, not a blank screen), incomplete (labels switch to "priced holdings · incomplete").

### 3.2 Portfolio and company

- Portfolio: segmented **Holdings | Insights**. Holdings rows: avatar, ticker + name, shares · avg cost, value and signed unrealised gain with %; stale/expected chips; sort sheet (value, gain, weight, name), "Include sold" toggle; sector filter. Insights = Reports (allocation, sectors, target vs actual, income, realised, tax estimate) in collapsible sections with "How this is calculated".
- Company: header (name, ticker, sector, last price with date and "entered by you" when manual) → position card (shares, avg cost, cost, value, unrealised, realised) → chart with summary → segmented **Ledger | Dividends** (dividends shows expected with "Mark received" and received with net/tax) → actions: Add (prefilled ticker), Set price, Edit company (overflow menu).
- Data: all existing (`holdings`, `activityEntries`, `/api/price-history`, `confirmDividendReceipt` used by web).
- States: no quote ("Add a price to value this holding"), quote older than split, sold out (history only), unknown cost ("Edit the opening entry to add its cost").

### 3.3 Plan (SIP)

- Purpose: decide this month's buys.
- Header: month switcher (this month and next; past months read-only), budget with Edit (sheet keyed by month, fixes REL-002), fee estimate saved per user.
- Mode switch: **Targets | Monthly Picks**.
- Targets: progress (bought this month / budget); suggested buys rows (shares, amount, current vs target weight bar, reason when 0: "Already at target", "Needs screening date", "No price"); leftover cash; "Record all…" opens a review sheet listing each buy with editable price/shares, then saves one revision. "Edit targets" opens the target editor: companies with weight sliders/steppers, running total that must reach 100%, cap note ("each company can receive at most 20% of the portfolio after this month"), screening date per company.
- Monthly Picks: shortlist picker (search, "Use target companies"), amount defaults to the month budget, method note and AI budget note ("Uses AI budget: ~$0.01; falls back to numbers-only ranking"); progress with phases; results with allocation, confidence, thesis, risks, sources; "Record these buys" uses the same review sheet. Inputs are saved (PAR-005).
- Data: `plan()`, `budgets`, `monthlyPicksShortlist`, `/api/recommendations`, `estimateMonthlyPicks`. Target editor and screening date writes are new UI over existing fields (`Company.target`, `approved`, `screenDate`).
- States: no budget ("Set this month's budget"), no targets (guided setup instead of an error, FIN-003), missing/stale prices (inline "Refresh prices" that includes target companies, REL-003), plan complete ("All of this month's budget is invested"), offline (read-only).

### 3.4 Market and benchmarks

- Today market card: KSE-100 level, change, session state, delayed note, intraday sparkline with summary label.
- Benchmark view (Portfolio › Insights › "Compare with KSE-100"): only when daily index history exists. Shows money-weighted comparison over the same dates. Until then the section explains it needs index history and does not draw a line.
- Data: `/api/market-summary` (exists). **New:** daily KSE-100 closes table + scraper (pattern of `psx-history-scrape.mjs`), and an XIRR/benchmark function in `lib/`.

### 3.5 Activity and add transaction

- Activity: month sections, filter chips (All, Buys, Sells, Dividends, Splits, Voided), search by ticker, row shows type icon + label + signed cash amount; tap opens entry detail with Correct / Void (read-only entries explain why and offer the right action). Import lives in the header menu.
- Add sheet: step 1 type (segmented); step 2 company (searchable list, recent first, "New company" with PSX check); step 3 details with native date picker (default today PKT), shares, price, fees, SIP month picker (default the month of the date); live summary line "100 × 50.00 + 50 fees = PKR 5,050.00"; Save. Split shows the after-split preview. Dividend shows "≈ PKR 1,500 gross for 300 shares held on 12 Sep".
- Success: sheet closes, toast "Buy recorded · Undo" (undo voids the new entry while the toast is visible).
- Duplicate submit: Save disables synchronously on first press; 409 shows "Changed on another device · Reloaded · Review and save again" with the draft kept.

### 3.6 Onboarding and import

- Welcome (3 short cards: what is tracked, prices are delayed, data syncs with web) → sign-in → "Start with" (Import AHL trades / Import CDC dividends / Add first holding / Skip).
- Import preview: file name, counts (trades to add, companies to add, duplicates skipped, PSX estimates replaced), first 5 rows, warnings; Confirm imports in one save; result screen with "View in Activity".

## 4. Supporting screens

- **Inbox (bell):** unread first, filters All/Unread/Cleared, swipe to clear, "Mark all read"; dividend alerts carry actions (Open company, Mark received). History keeps cleared items like the web.
- **More / account & privacy:** profile; Security (app lock, require after 30 s, hide in app switcher, signed-in devices with "This phone" marker and pending sign-outs); Notifications (dividend alerts, test); Tax status (filer / non-filer); Data (export backup via share sheet, delete account with typed confirmation); AI usage this month vs cap; Appearance (System/Light/Dark); About (version, update id, environment; staging debug lives here, SEC-008).
- **Reports:** inside Portfolio › Insights (see 3.2); PDF export remains web.
- **Quotes / manual price:** sheet from company: price, date picker (no future), note that it holds until PSX publishes a later day.
- **Research:** not in mobile navigation; admins see "Research desk opens on the web" in More with a link.
- **Monthly Picks:** inside Plan (see 3.3).
- **Lock screen:** brand mark, "Sipwise is locked", Unlock button (role button), content hidden from accessibility.

## 5. Component and state rules

- Card: title row (Overline label + optional action), body, optional footer note. Never more than one display number per card.
- Row: leading avatar/icon, title + subtitle (two lines max), trailing value stack; whole row is one accessible button with a composed label ("MEBL, 1,000 shares, value PKR 312,000, unrealised gain plus PKR 42,000").
- Chips: status chips are non-interactive and have icon + word; filter chips are toggles with `selected` state.
- Buttons: primary (filled), tonal (primarySoft), outline, text, destructive (loss text on lossSoft); min height 48.
- Notices: info / warn / error / offline, each with an icon and one action at most.
- Empty states: say what is missing and offer the one action that fixes it.
- Loading: skeletons that match final layout; spinners only inside buttons.
- Errors: inline at the place of failure, keep user input, offer Retry.
- Destructive actions (void, sign out device, delete account): confirmation sheet naming the object; void says the entry stays in history.
- Planned vs actual, expected vs received, partial vs complete valuation and stale vs current are always marked in text, never only by colour.

## 6. Feature to data map

| Proposed item | Source | Dependency |
|---|---|---|
| Summary (value, cost, unrealised, completeness) | `lib/portfolio.ts#holdings` | New shared `portfolioSummary()` in `lib/` (pure) |
| Realised, dividends, total return | `lib/portfolio-reports.ts` (`taxSummary`, `grandTotalReturn`) | Expose before-tax total too |
| Money in / net invested | ledger | New pure function |
| Value vs money-in chart | `lib/price-history.ts#portfolioValueSeries` + `/api/price-history` | Per-ticker history fetch (web already does this) |
| This-month progress | `plan()` `already`, `budget` | none |
| Next actions | quotes dates, dividends `status`, `plan().errors` | none |
| Target editor | `Company.target`, `approved`, `screenDate` | UI only; same validation |
| Mark received | `lib/portfolio.ts#confirmDividendReceipt` (already shared) | UI only |
| Auto dividends on mobile | `lib/portfolio.ts#pendingAutoDividends`, `lib/notifications.ts#announcementNotifications` (already shared) | Port the web's revisioned save loop, or run it server-side (PAR-002) |
| Inbox actions | `notifications` with `read`/`clearedAt` | none |
| Picks persistence | `monthlyPicksShortlist`, `budgets` | none |
| Tax status | `taxProfile.filerStatus` | none |
| Export backup | portfolio JSON | Share sheet (`expo-sharing`, new dependency, no native build if already in SDK) |
| Delete account | — | **New** `DELETE /api/me` (planned in `plans/mobile-app.md` §4.7) |
| Benchmark | — | **New** daily KSE-100 history table + scraper; XIRR function |
| Appearance | — | `userInterfaceStyle: 'automatic'` needs a **native build** |
| App-switcher privacy | — | Native module or config; **native build** |
