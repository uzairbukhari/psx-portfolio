# Android feature parity

Single source of truth for the native Android rewrite. Status values: Done, Partial, Pending.
Feature numbers and the Expo implementation come from `plans/native-android-rewrite.md` section 1.10.

| # | Feature | Expo implementation | Status |
|---|---|---|---|
| 1 | Google sign-in, token exchange | `AuthProvider.tsx`, google-signin | Done |
| 2 | Session token, 401 sign-out, queued revoke | `token-store.ts`, `session-cleanup.ts` | Partial (token, profile, queued revoke done; WorkManager retry pending) |
| 3 | Vault status/setup/recovery key/unlock/recover/erase | `VaultProvider.tsx`, `VaultScreens.tsx`, `lib/vault-client.ts` | Done (erase pending) |
| 4 | Native Argon2id | `modules/sipwise-argon2` | Done |
| 5 | Biometric vault unlock | `biometric-key*.ts` | Pending |
| 6 | Privacy cover + 60 s relock | `app-active.ts`, `lock-policy.ts` | Partial (60 s relock + recents thumbnail off; cover pending) |
| 7 | Offline ciphertext cache | `file-cache.ts` | Done |
| 8 | Account load + public overlay | `usePortfolio.ts`, `lib/portfolio-view.ts` | Pending |
| 9 | Revisioned save, conflict, undo | `usePortfolio.save`, Toast | Done |
| 10 | Portfolio selection (All / one), chooser sheet | `PortfolioSelection.tsx`, `PortfolioChooser.tsx` | Done (chooser in the top bar; selection is kept only while unlocked, like Expo) |
| 11 | Today hero, return breakdown | `(tabs)/index.tsx`, `data/today.ts` | Partial (headline, return breakdown; net-worth overview pending) |
| 12 | Next actions | `data/today.ts#nextActions` | Partial (shown; tapping an action pending) |
| 13 | Month progress | `data/today.ts#monthProgress` | Done |
| 14 | First-use welcome | index.tsx | Pending |
| 15 | Market pulse + live SSE | `MarketPulse.tsx`, `useLiveMarket.ts`, `live-market.ts` | Pending |
| 16 | Value vs money in, XIRR, KSE-100 compare | `track-record.ts`, `TrackRecordCards.tsx` | Pending |
| 17 | Net worth card + donut | `NetWorthCard.tsx`, `lib/account-overview.ts` | Pending |
| 18 | Holdings list, sort, sector filter, include sold | `portfolio.tsx`, `holdings-view.ts` | Partial (sort, sector, sold-out done; scope chooser pending) |
| 19 | Per-portfolio breakdown (All) | `AccountOverview.tsx` | Pending |
| 20 | Funds / plans / gold (read-only) | `MutualFunds`, `SavingsPlans`, `GoldSilver` | Pending |
| 21 | Insights report sections | `Insights.tsx`, `lib/portfolio-reports.ts` | Pending |
| 22 | Company page, chart ranges | `company/[ticker].tsx`, `lib/price-history.ts` | Done |
| 23 | Company ledger + dividends tab | same | Done (tap an editable entry to void it; correcting an entry pending) |
| 24 | Add/edit/void transaction (5 kinds) | `transaction.tsx`, `data/mutations.ts`, `entry-form.ts` | Partial (add buy, sell, opening, dividend, split with Undo; edit and void pending) |
| 25 | New company confirmed via PSX | transaction.tsx | Pending |
| 26 | Date and month pickers | `DatePicker.tsx`, `MonthPicker.tsx` | Partial (date picker on the entry form; month picker pending) |
| 27 | Manual price | `quote.tsx` | Done |
| 28 | Mark dividend received | `received.tsx` | Done |
| 29 | Targets editor | `targets.tsx`, `lib/targets.ts` | Done |
| 30 | Plan month, budget, suggested buys, record | `plan.tsx`, `data/sip.ts`, `ReviewBuysSheet.tsx` | Partial (targets mode: month, budget, suggested buys, review and record, fee and old-quote settings; Monthly Picks pending) |
| 31 | Monthly Picks on device | `PicksView.tsx`, `lib/picks-run.ts` | Pending |
| 32 | Refresh prices (queued job + poll) | `lib/import-refresh.ts` | Pending |
| 33 | Activity ledger, search, filters, month groups | `activity.tsx`, `activity-view.ts` | Partial (filters, search, month groups; sticky headers and edit pending) |
| 34 | Inbox with filters and actions | `inbox.tsx`, `lib/notification-actions.ts` | Pending |
| 35 | Auto dividends on load | `data/auto-dividends.ts`, `lib/dividend-sync.ts` | Pending |
| 36 | Push opt-in, token, test, tap routing | `push.ts`, `PushBridge.tsx` | Pending |
| 37 | Appearance setting | `ThemeProvider.tsx` | Pending |
| 38 | Signed-in devices | more.tsx | Pending |
| 39 | Tax status | more.tsx, `portfolio-account.ts` | Pending |
| 40 | AI usage | more.tsx | Pending |
| 41 | Encrypted backup / readable export | `backup.ts`, `lib/vault-backup.ts` | Pending |
| 42 | Lock now, sign out, delete account | more.tsx, `DeleteAccountSheet.tsx` | Partial (lock, sign out done; delete account in view model, UI pending) |
| 43 | Manage portfolios | `portfolios.tsx` | Pending |
| 44 | Usage analytics + opt-out | `analytics.ts`, `AnalyticsBridge.tsx`, `screens.ts` | Pending |
| 45 | Haptics, reduce motion | `haptics.ts`, `motion.ts` | Pending |
| 46 | Old routes / deep links | redirects, `routes.test.ts` | Pending |
| 47 | Admin link to web Research desk | more.tsx | Pending |
| 48 | Environment variants (dev/staging/prod) | `app.config.ts` | Pending |
| 49 | Local data migration from RN | n/a | Pending |
| 50 | Update available prompt | expo-updates OTA | Pending |
