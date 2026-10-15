# Android release pipeline

1. Run **android-cut-release** (workflow_dispatch) with bump and optional rc number. It computes the next `android-v*` tag and calls the release workflow.
2. **android-release** builds signed APKs and the AAB from the tagged commit, checks the signing certificate SHA-1 and that versionCode is above `ANDROID_PREV_VERSION_CODE`, and publishes a GitHub pre-release with `SHA256SUMS` and `mapping.txt`.
3. **android-promote** (environment `android-production`, needs approval) makes that pre-release the latest release. The in-app updater reads the latest release.

versionCode = BASE + major*100000 + minor*1000 + patch*10 + slot (final slot 9, rc n = n-1). 1.0.0 is 100009.

## One-time owner setup

- GitHub environments `android-release` and `android-production` (production with required reviewers)
- Secrets: base64 production and staging keystores, passwords, aliases, expected cert SHA-1, `google-services.json`
- Repository variables: `API_BASE_URL_PROD`, `ANDROID_PREV_VERSION_CODE` (from `npx eas-cli build:version:get -p android`)
- Branch protection requiring `android-ci / build`
- Keystores must be the existing EAS ones so the app installs over the React Native build
- Firebase service account for the server-side FCM sender

## Where each value comes from

Add secrets under GitHub > Settings > Secrets and variables > Actions (use the `android-release` environment for the signing ones); variables are on the Variables tab.

| Name | Kind | Where to find it |
| --- | --- | --- |
| `ANDROID_KEYSTORE_PROD_B64`, `ANDROID_KEYSTORE_STAGING_B64` | secret | `npx eas-cli credentials -p android` > Download existing keystore (pick the production and the staging profile), then `base64 -w0 keystore.jks` |
| `ANDROID_KEYSTORE_PROD_PASSWORD`, `ANDROID_KEYSTORE_STAGING_PASSWORD` | secret | Printed by the same EAS credentials download |
| `ANDROID_KEY_PROD_ALIAS`, `ANDROID_KEY_STAGING_ALIAS` | secret | Printed by the same EAS credentials download |
| `ANDROID_KEY_PROD_PASSWORD`, `ANDROID_KEY_STAGING_PASSWORD` | secret | Printed by the same EAS credentials download |
| `ANDROID_CERT_SHA1_PROD`, `ANDROID_CERT_SHA1_STAGING` | secret | `keytool -list -v -keystore keystore.jks` (SHA1 line) |
| `ANDROID_GOOGLE_SERVICES_JSON_B64` | secret | Firebase console > Project settings > Your apps: register `com.uzairbukhari.sipwise` and `com.uzairbukhari.sipwise.staging`, download `google-services.json`, then `base64 -w0 google-services.json` |
| `ANDROID_PREV_VERSION_CODE` | variable | `npx eas-cli build:version:get -p android` |
| `API_BASE_URL_PROD` | variable | The production Worker URL, no trailing slash |
| `FCM_SERVICE_ACCOUNT_JSON` | Worker secret (main and quote-refresh) | Firebase console > Project settings > Service accounts > Generate new private key; `npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON` |
| Google OAuth Android clients | Google Cloud console | APIs & Services > Credentials > Create OAuth client ID > Android, once per package name, with the SHA-1 of the matching keystore |

The staging and production keystores are different, so each pin and each Google client takes its own SHA-1. The release workflow prints the real production SHA-1 when its pin check fails; the signing certificate of a published APK can also be read from its signing block. A wrong pin stops the release at the "Check the signing certificates are the pinned ones" step, and a Google client with the wrong SHA-1 or package makes sign-in end with "[16] Account reauth failed".

Never commit the keystores, `google-services.json` or the service account file.

## Fonts

Inter (regular, medium, semibold) is bundled in `android/core/designsystem/src/main/res/font/` from the `@expo-google-fonts/inter` npm package. The font is licensed under the SIL Open Font License 1.1 (`docs/INTER-LICENSE.txt`).
