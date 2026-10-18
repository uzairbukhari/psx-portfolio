# Google Play publishing pack

Status: prepared 2026-10-18. Everything under "You do" needs the owner's Google account.

## What the repo now produces

`android-release` also builds `sipwise-play-<version>.aab` (flavor `play`): same package `com.uzairbukhari.sipwise` as production, but without the GitHub self-updater (`BuildConfig.SELF_UPDATE=false`) and without `REQUEST_INSTALL_PACKAGES` (`android/app/src/play/AndroidManifest.xml`). Play policy forbids apps updating themselves outside Play, so upload this bundle, never `sipwise-<version>.aab`. The GitHub APK keeps its updater.

versionCode must stay above anything already on Play and is unique per upload; the existing scheme (1.0.0 = 100009) works. Play does not accept rc codes lower than a later upload, so upload only the build you intend to release.

## Signing and Google sign-in

- Enrol in Play App Signing (default for new apps). Option A (simplest): in the first release, upload the existing production keystore as the app signing key ("Use a key from Java Keystore" via PEPK); installs over the sideloaded APK keep working and the Google OAuth SHA-1 stays valid. Option B: let Google generate the key; then the Play-installed app has a different certificate than the GitHub APK, so (1) the two cannot be installed over each other, and (2) you must add Google's **app signing** SHA-1 (Play Console > Test and release > App signing) as another Android OAuth client for `com.uzairbukhari.sipwise`, otherwise sign-in fails with "[16] Account reauth failed". Also add the SHA-1 to the Firebase app.
- Keep the upload key (optionally a separate `SIPWISE_PLAY_*` keystore; falls back to production).

## Target API

`targetSdk = 36`, `compileSdk = 36`. Play requires 36 for new apps and updates from 31 Aug 2026 ([requirement](https://developer.android.com/google/play/requirements/target-sdk)); met.

## Policy points

- Privacy policy URL: `https://<production host>/privacy` (page exists, updated for in-app account deletion).
- Account deletion: Play needs an in-app path and a web path. In-app: More > Delete account (exists). Web URL for the form: the privacy page "Deleting your data" section plus support@sipwise.trade; ideally add a public `/delete-account` page (not done).
- Financial features declaration: the app is a ledger/planner that never trades. The closest listed category is "Stock trading and portfolio management" (applies to apps that let users manage a portfolio); declare it, plus country Pakistan, and say no loans, no payments. If Play reviewers push back, confirm via Console help. Expect the app not to be treated as a licensed financial service; add a disclaimer in the listing: "Not investment advice. Sipwise does not place orders or connect to brokers."
- Data safety (answer from the code; verify against Google's current form): collected: email, name, profile picture (account management, linked to you), device token (push), app interactions (analytics, optional), crash logs (diagnostics). Portfolio data is end-to-end encrypted on device and never readable by the server; Google lets you omit data that is only processed on device and E2E encrypted so the server cannot read it, but state it in the listing. Data encrypted in transit: yes. Users can request deletion: yes. No data shared with third parties; no ads.
- Permissions: INTERNET, POST_NOTIFICATIONS (runtime prompt on Android 13+), biometric (no declaration needed). No REQUEST_INSTALL_PACKAGES in the Play bundle.
- Content rating questionnaire: no violence/UGC; finance app, rating Everyone. Ads: none. Target audience: 18+.
- App category: Finance. Free.

## You do

1. Pay the one-off 25 USD and register a Play developer account. A personal account created after Nov 2023 must run a **closed test with at least 12 testers opted in for 14 continuous days** before applying for production. An organisation account skips this but needs a D-U-N-S number.
2. Create the app, fill App content (privacy policy, ads, data safety, financial features, content rating, target audience, government apps = no, account deletion URL).
3. Decide Option A or B above and set the OAuth/Firebase SHA-1s before testers try to sign in.
4. Upload `sipwise-play-<version>.aab` to the closed test track, add testers by email or Google Group.
5. Phone screenshots (2-8, 16:9 to 9:16, min 320 px) from `plans/android-ui-redesign/*.png` style screens, from a real build with the seeded test account (never real holdings). Feature graphic 1024x500 and a 512x512 icon are not in the repo yet.

## Listing text (draft)

**Name:** Sipwise: PSX Portfolio

**Short description (80):** Private PSX portfolio, dividends and monthly SIP planner. Encrypted.

**Full description:**

Sipwise is a ledger and planner for investors on the Pakistan Stock Exchange.

- Holdings and returns: cost basis, realised and unrealised gains, dividend income.
- Monthly SIP planner: decide how much to put in each month and how to split it, within your own limits.
- Dividends: announcements for companies you hold, with a push alert when one is declared.
- Gold, silver, mutual funds, savings plans and foreign currency alongside your shares, with a combined net worth view.
- Reports and a full activity timeline.
- Private by design: your portfolio is encrypted on your phone with a vault password and a recovery key before it is sent. The server stores only ciphertext and cannot read your holdings.

Sipwise does not connect to your broker, never places orders and does not give investment advice. Prices are public market data and can be delayed.

## Not done

Feature graphic, 512 px icon, screenshots, a `/delete-account` web page, Play Console forms, and the closed test.
