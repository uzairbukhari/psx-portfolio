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
