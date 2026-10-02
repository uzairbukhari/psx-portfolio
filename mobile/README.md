# Sipwise mobile app (Expo / React Native)

Private-install app for Android and iPhone. It talks to the same Cloudflare Worker API as the web app and reuses the pure calculation modules in `../lib` (see `metro.config.js`, `@shared/*`). It is **not** published to the App Store or Google Play; builds are installed from EAS install links.

Plan and phases: `plans/mobile-app.md` in the project files.

## Develop

```
cd mobile
npm ci
npm run typecheck && npm test
APP_VARIANT=staging API_BASE_URL=https://<staging worker> npx expo start --dev-client
```

Native Google Sign-In does not work in Expo Go; use a development build (`eas build --profile development`).

## Look and feel

The Steady Steps design lives in `src/theme` (tokens, light and dark palettes, Appearance setting) and `src/ui/kit.tsx`. Colours come from `useTheme()` / `makeStyles()`, never from fixed constants; `palette.test.ts` checks the contrast of every text pair. The Appearance choice (System / Light / Dark) is stored in SecureStore (`sipwise.appearance`) and "System" follows the phone. `userInterfaceStyle: 'automatic'` in `app.config.ts` only takes effect in the next native build; until then the JS theme still switches, but the OS dialog theme follows the old fixed setting.

Navigation: tabs Today, Portfolio, Plan, Activity; the header bell opens the Inbox (`/inbox`) and the avatar opens More (`/more`). Old paths still work and redirect: `/sip` → `/plan`, `/alerts` → `/inbox`, `/account` → `/more`, `/reports` → `/portfolio?segment=insights`, `/picks` → `/plan?mode=picks` (guarded by `src/routes.test.ts`).

## Variants

`APP_VARIANT` = `development` | `staging` | `production` (see `app.config.ts`). Each has its own bundle id (`com.uzairbukhari.sipwise[.dev|.staging]`) so they install side by side. Staging points at the staging Worker.

## Environment (set as EAS env vars / secrets, never committed)

| Name | What |
|---|---|
| `API_BASE_URL` | Worker origin, e.g. `https://psx-portfolio-sip-staging.<subdomain>.workers.dev` |
| `GOOGLE_WEB_CLIENT_ID` | Existing web OAuth client id (used by the Google SDK to mint ID tokens) |
| `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_IOS_URL_SCHEME` | iOS OAuth client id and its reversed form |
| `EAS_PROJECT_ID` | From `eas init` |

The Worker needs `GOOGLE_MOBILE_CLIENT_IDS` (wrangler var) = the web + iOS (+ Android) client ids accepted as ID-token audiences. Empty disables `/api/auth/mobile/google`.

## Builds

`eas build --profile staging --platform android` gives an APK install link; `--platform ios` gives an ad hoc build (devices registered once with `eas device:create`; needs an Apple Developer membership). JS-only changes can ship with `eas update --channel staging`.

## Over-the-air updates

Use the scripts rather than a bare `eas update`: `app.config.ts` picks the API URL from `APP_VARIANT`, which `eas build` sets from `eas.json` but `eas update` does not. When it is unset the config now falls back to staging (only `npm start` / `android` / `ios` use localhost), so a forgotten variant no longer points the app at localhost.

The scripts publish for Android only (`--platform android`): a bare `eas update` also exports a web bundle, which fails because `react-native-web` is not installed. Add `--platform ios` there once iOS builds exist.

```
npm run update:staging -- --message "what changed"
```

### Automatic updates on merge

`.github/workflows/mobile-update.yml` runs `update:staging` after every merge to `main` that touches `mobile/**` or `lib/**` (it can also be run by hand from the Actions tab). It type-checks and tests first, then publishes to the `staging` channel only, so it never spends a build. One-time setup: create an Expo access token (expo.dev > Account settings > Access tokens) and add it as the secret `EXPO_TOKEN` in the `prod` GitHub environment (Settings > Environments > prod); without it the workflow skips. Changes to native code or `app.config.ts` plugins still need a manual `eas build`, because installed apps only accept updates for their own app version. Production stays manual (`npm run update:production`) until a production build is installed.
