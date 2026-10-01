# Web and mobile feature parity

Status key: **Complete** (same capability), **Partial** (exists with a material difference), **Missing** (web has it, mobile does not), **Web-only (intended)** (deliberately not on mobile), **Mobile-only**. "Placement" is where the redesign puts it (see `design-spec.md`). Paths are relative to the repo root.

## Portfolio and ledger

| Capability | Web | Mobile | Status | Difference | Recommendation / placement | ID |
|---|---|---|---|---|---|---|
| Portfolio value summary | `app/portfolio-value-card.tsx:145-170` | `mobile/app/(tabs)/index.tsx:62-89` | Partial | Mobile sums only holdings with price **and** cost; labels unrealised gain "all time"; web shows "incomplete" states | Parity, shared summary function | FIN-001, FIN-002 |
| Value / gain over time chart | `app/portfolio-value-card.tsx` (`portfolioValueSeries`) | none | Missing | Web plots remaining unrealised gain by day (1M/1Y/All) | Today screen, collapsed by default | PAR-001 |
| Holdings list | Holdings tab, sort, sector filter, shortlist dots, "Show sold out" | `index.tsx:112-139`, value-sorted, open only | Partial | No sort/filter, sold-out hidden | Portfolio tab with sort sheet and "Include sold" | UX-009 |
| Market pulse (KSE-100) | `app/psx-market-pulse.tsx` (pyPSX SSE when configured, shortlist) | `src/ui/MarketPulse.tsx` (60 s poll) | Partial | No live stream, no shortlist movers (planned in `plans/mobile-app.md` §6 Phase 3) | Today screen context card | PERF-003 |
| Company page | `app/company-detail.tsx` (cards, chart, ledger, dividends, Edit company, Mark received) | `mobile/app/company/[ticker].tsx` | Partial | No Mark received, no Edit company, no dividends section, no face value | Company screen with Ledger / Dividends segments | PAR-003, PAR-007 |
| Add buy / sell / opening | `record()` `app/portfolio.tsx:1076` | `mobile/app/transaction.tsx` | Complete | Same validation via shared `validate`; mobile confirms new symbols against PSX | Keep; redesign entry flow | UX-004 |
| Correct / void entry | `correctTrade`, `correctDividend`, `correctStockSplit` | `transaction.tsx` edit mode + Void | Complete | Same void-and-insert audit trail | Keep | SEC-006 |
| Record dividend (manual) | `recordDividend()` `:1142` | `recordDividend` `src/data/mutations.ts:41` | Complete | Identical gross = per share × shares held on date | Keep | — |
| Expected → received dividend | `confirmReceipt()` `:1007` | none | Missing | Auto dividends read-only on mobile | Company › Dividends and from alert | PAR-003 |
| PSX auto dividends recorded on load | `recordAutoDividends()` `:413` | none | Missing | Mobile depends on the web being opened | Move to shared lib or server | PAR-002 |
| Stock split | `recordStockSplit()` with preview | `transaction.tsx` kind "Split" | Partial | No preview | Add preview | UX-010 |
| Manual price | quote dialog | `mobile/app/quote.tsx` | Complete | — | Company › price menu | — |
| Refresh PSX prices | `refresh()` `:1033` (held + shortlist) | `usePortfolio.refreshPrices` (open only) | Partial | Misses target / shortlist companies | Pull to refresh everywhere; SIP banner | REL-003 |
| Add company | `saveCompany()`, `verifyPsxSymbol` | `addCompany` + `/api/quotes` check | Complete | — | Inside add-transaction company picker | — |
| Edit company (name, sector, face value) | `company-detail.tsx:401` | none | Missing | | Company › menu | PAR-007 |
| Price history | `/api/price-history` chart | same API, `LineChart` | Complete | No axis labels or accessible summary | Company | UX-003 |
| Activity timeline | `app/ledger-timeline.tsx` | `mobile/app/(tabs)/activity.tsx` | Partial | No filters or search, no voided view, no grouping | Activity tab with month sections and filters | UX-006 |

## Planning and research

| Capability | Web | Mobile | Status | Difference | Recommendation / placement | ID |
|---|---|---|---|---|---|---|
| Target-weight SIP plan (`plan()`) | Only as a WebMCP tool `app/portfolio.tsx:573`; no screen | `mobile/app/(tabs)/sip.tsx` | Mobile-only | Targets cannot be edited anywhere | Plan tab "Targets" mode with target editor | FIN-003 |
| Monthly budgets | Saved from Monthly Picks `app/monthly-picks.tsx:56-60` | SIP tab Save | Partial | Mobile month-switch bug | Plan tab header | REL-002, FIN-005 |
| Monthly Picks (setup, progress, results) | `app/monthly-picks.tsx`, `picks-setup.tsx`, `picks-results.tsx` (search, "Target holdings", sources, Enter price, Edit inputs) | `mobile/app/picks.tsx` | Partial | No search, no sources list, shortlist/amount not saved, rerun always forced | Plan tab "Monthly Picks" mode | FIN-004, PAR-005 |
| Facts refresh request | `POST {action:'refresh-facts'}` | none | Missing | Mobile runs use cached facts | Picks setup "Update company data" | PAR-008 |
| Record buys from a plan | `recordPicks()` | "Record this buy" per row | Complete | One at a time on mobile | Allow "Record all" with review | — |
| Reports (allocation, sectors, target vs actual, gains, monthly, income, tax) | `app/portfolio-reports.tsx` (+ PDF) | `mobile/app/reports.tsx` | Partial | No dividend income detail, no tax section, no total return, no PDF | Portfolio › Insights | FIN-006 |
| Research desk | `app/research-desk.tsx` (super-admin) | none | Web-only (intended) | Long-running browser runner (`plans/mobile-app.md` §10.4) | Not in mobile nav; show "Open on web" for admins in More | — |

## Notifications, account, data

| Capability | Web | Mobile | Status | Difference | Recommendation / placement | ID |
|---|---|---|---|---|---|---|
| Notification bell / list | bell + `app/notifications-view.tsx` | `mobile/app/(tabs)/alerts.tsx` | Partial | No mark read, clear, filter or history | Bell in Today header → Inbox screen | PAR-004 |
| Dividend push | — | `src/push/*` + scraper | Mobile-only | — | More › Notifications | SEC-004, REL-004 |
| Sign-in | Google OAuth cookie | Native Google → bearer | Complete | — | — | — |
| Signed-in devices | — | Account | Mobile-only | No "this device" marker | More › Security | — |
| App lock | — | Account | Mobile-only | — | More › Security | SEC-001 |
| AI usage | Settings | Account | Complete | — | More | — |
| Tax filer status | Settings `settings-view.tsx:288` | none | Missing | Mobile reports tell user to use the web | More › Tax | PAR-009 |
| Backup export / restore | Settings `exportBackup`, `restoreBackup` | none | Missing | | More › Data (export via share sheet; restore stays web-only) | PAR-010 |
| AHL / CDC JSON import | Settings | `mobile/app/import.tsx` | Partial | No preview | Activity › Import (and onboarding) | UX-005 |
| Finqalab PDF import | Settings (pdf.js) | none | Web-only (for now) | Stated in app | Keep web-only until server-side PDF parsing | — |
| Delete account | none | none | Missing on both | Planned in `plans/mobile-app.md` §4.7 | More › Data, after typed confirmation | PAR-011 |
| Role display | Research desk gating | "Admin" badge | Complete | — | — | — |

## Hard to find versus absent

- **Hard to find:** Monthly Picks (SIP banner and Account › Tools), Reports and Import (Account › Tools only), corrections (only by tapping an entry on a company page, with a single hint line), manual price (button on company page).
- **Absent:** target editing (both platforms), Mark received, notification history and actions, tax status, backup, delete account, value-over-time chart.

## Recommendation summary

Bring to parity on mobile: summary semantics, Mark received, auto-dividend recording (best server-side), alert actions, price refresh scope, Picks persistence, tax status, value chart, sold-out toggle.
Keep deliberately different: Research desk (web-only, admin), Finqalab PDF import (web-only until parsing moves server-side), backup restore (web-only, destructive), push and app lock (mobile-only).
New on both: target-weight editor (FIN-003), total-return and contribution views, benchmark (needs index history data).
