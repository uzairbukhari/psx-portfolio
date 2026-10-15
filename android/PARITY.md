# Android feature parity

Single source of truth for the native Android rewrite. Status values: Done, Partial, Pending.
Feature numbers and the Expo implementation come from `plans/native-android-rewrite.md` section 1.10.

| # | Feature | Expo implementation | Status |
|---|---|---|---|
| 1 | Google sign-in, token exchange | `AuthProvider.tsx`, google-signin | Done |
| 2 | Session token, 401 sign-out, queued revoke | `token-store.ts`, `session-cleanup.ts` | Partial (token, profile, queued revoke done; WorkManager retry pending) |
| 3 | Vault status/setup/recovery key/unlock/recover/erase | `VaultProvider.tsx`, `VaultScreens.tsx`, `lib/vault-client.ts` | Done (erase pending) |
| 4 | Native Argon2id | `modules/sipwise-argon2` | Done |
| 5 | Biometric vault unlock | `biometric-key*.ts` | Done (Android Keystore key behind BiometricPrompt, dropped when biometrics change; opt-in on the unlock screen and in More) |
| 6 | Privacy cover + 60 s relock | `app-active.ts`, `lock-policy.ts` | Done (60 s relock, recents thumbnail off, in-app cover as soon as the app leaves the foreground) |
| 7 | Offline ciphertext cache | `file-cache.ts` | Done |
| 8 | Account load + public overlay | `usePortfolio.ts`, `lib/portfolio-view.ts` | Done (prices, announcements, face values and company names overlay the ledger on the device, never saved) |
| 9 | Revisioned save, conflict, undo | `usePortfolio.save`, Toast | Done |
| 10 | Portfolio selection (All / one), chooser sheet | `PortfolioSelection.tsx`, `PortfolioChooser.tsx` | Done (chooser in the top bar; selection is kept only while unlocked, like Expo) |
| 11 | Today hero, return breakdown | `(tabs)/index.tsx`, `data/today.ts` | Partial (headline, return breakdown on Today; net worth lives at the top of Holdings) |
| 12 | Next actions | `data/today.ts#nextActions` | Partial (shown; tapping an action pending) |
| 13 | Month progress | `data/today.ts#monthProgress` | Done |
| 14 | First-use welcome | index.tsx | Pending |
| 15 | Market pulse + live SSE | `MarketPulse.tsx`, `useLiveMarket.ts`, `live-market.ts` | Partial: KSE-100, indices, breadth and day chart are polled every 60 s while the market is open; live SSE ticks skipped |
| 16 | Value vs money in, XIRR, KSE-100 compare | `track-record.ts`, `TrackRecordCards.tsx` | Done (in Insights: value vs money in, yearly return, KSE-100 comparison with range chips; the collapsed card on Today is not repeated) |
| 17 | Net worth card + donut | `NetWorthCard.tsx`, `lib/account-overview.ts` | Done (net worth, asset mix donut and legend at the top of Holdings; incomplete-valuation notice) |
| 18 | Holdings list, sort, sector filter, include sold | `portfolio.tsx`, `holdings-view.ts` | Partial (sort, sector, sold-out done; scope chooser pending) |
| 19 | Per-portfolio breakdown (All) | `AccountOverview.tsx` | Done (per-portfolio breakdown in the All view; tap opens that portfolio) |
| 20 | Funds / plans / gold (read-only) | `MutualFunds`, `SavingsPlans`, `GoldSilver` | Done (mutual funds, savings plans, gold and silver, read-only, with public rates and fund prices) |
| 21 | Insights report sections | `Insights.tsx`, `lib/portfolio-reports.ts` | Done (summary, allocation, sectors, actual vs target, gain by company, recent buying, income and realised) |
| 22 | Company page, chart ranges | `company/[ticker].tsx`, `lib/price-history.ts` | Done |
| 23 | Company ledger + dividends tab | same | Done (tap an editable entry to void it; correcting an entry pending) |
| 24 | Add/edit/void transaction (5 kinds) | `transaction.tsx`, `data/mutations.ts`, `entry-form.ts` | Done (add, edit, void with Undo for all five kinds) |
| 25 | New company confirmed via PSX | transaction.tsx | Pending |
| 26 | Date and month pickers | `DatePicker.tsx`, `MonthPicker.tsx` | Partial (date picker on the entry form; month picker pending) |
| 27 | Manual price | `quote.tsx` | Done |
| 28 | Mark dividend received | `received.tsx` | Done |
| 29 | Targets editor | `targets.tsx`, `lib/targets.ts` | Done |
| 30 | Plan month, budget, suggested buys, record | `plan.tsx`, `data/sip.ts`, `ReviewBuysSheet.tsx` | Partial (targets mode: month, budget, suggested buys, review and record, fee and old-quote settings; Monthly Picks pending) |
| 31 | Monthly Picks on device | `PicksView.tsx`, `lib/picks-run.ts` | Done (shortlist, amount, public data gathering with scrape wait, ranking and sizing on the phone, results saved to the vault, record all via a confirm dialog; "record only this buy" opens the entry form for the ticker, share and price prefill pending) |
| 32 | Refresh prices (queued job + poll) | `lib/import-refresh.ts` | Done (queued job with polling; server wording shown; prices reload when it settles) |
| 33 | Activity ledger, search, filters, month groups | `activity.tsx`, `activity-view.ts` | Partial (filters, search, month groups, tap to edit or void; sticky headers pending) |
| 34 | Inbox with filters and actions | `inbox.tsx`, `lib/notification-actions.ts` | Done (bell with unread badge; Inbox, Unread, Cleared, History; read, clear, restore, delete cleared; Mark received opens the company page) |
| 35 | Auto dividends on load | `data/auto-dividends.ts`, `lib/dividend-sync.ts` | Done (fund payouts pending with funds) |
| 36 | Push opt-in, token, test, tap routing | `push.ts`, `PushBridge.tsx` | Done (opt-in, FCM token, test notification, tap on a market update opens the Inbox; needs google-services.json and the FCM server secret) |
| 37 | Appearance setting | `ThemeProvider.tsx` | Done |
| 38 | Signed-in devices | more.tsx | Done |
| 39 | Tax status | more.tsx, `portfolio-account.ts` | Done |
| 40 | AI usage | more.tsx | Done (this month's spend and tokens when the server has a figure) |
| 41 | Encrypted backup / readable export | `backup.ts`, `lib/vault-backup.ts` | Done (encrypted backup and readable export through the share sheet) |
| 42 | Lock now, sign out, delete account | more.tsx, `DeleteAccountSheet.tsx` | Done (lock, sign out, delete account) |
| 43 | Manage portfolios | `portfolios.tsx` | Done (add, rename, lock or unlock, delete empty, each with Undo) |
| 44 | Usage analytics + opt-out | `analytics.ts`, `AnalyticsBridge.tsx`, `screens.ts` | Done (catalog events only, batches to /api/events, per-device switch in More, account_state once per session) |
| 45 | Haptics, reduce motion | `haptics.ts`, `motion.ts` | Partial (success haptic on every saved change; animations follow the system setting) |
| 46 | Old routes / deep links | redirects, `routes.test.ts` | Done (sipwise:// and sipwise-staging:// links; old Expo paths sip, alerts, account, reports, history keep working) |
| 47 | Admin link to web Research desk | more.tsx | Done (super admins get a Research desk link that opens the web) |
| 48 | Environment variants (dev/staging/prod) | `app.config.ts` | Done (staging and production flavours with their own application ids, app names, API URLs and link schemes) |
| 49 | Local data migration from RN | n/a | Skipped (deviation from plan section 7.2: the Android app starts from the server vault; nothing local needs carrying over because everything is in the encrypted vault) |
| 50 | Update available prompt | expo-updates OTA | Done (in-app installer from GitHub Releases; see docs/android-release.md) |
