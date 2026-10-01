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

Use the scripts, not a bare `eas update`: `app.config.ts` picks the API URL from `APP_VARIANT`, which `eas build` sets from `eas.json` but `eas update` does not (it would fall back to the `development` variant and point the app at localhost).

```
npm run update:staging -- --message "what changed"
```
