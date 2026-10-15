# Sipwise for Android (native)

Kotlin + Jetpack Compose + Material 3 rewrite of the Expo app in `mobile/`. The iPhone app stays on React Native.

## Modules

- `:core:model` shared model types (JVM)
- `:core:vault` vault crypto, byte-compatible with `lib/vault-crypto.ts` (JVM, tested against `tests/fixtures/vault-vector.json`)
- `:core:designsystem` Material 3 theme, palettes, contrast checks
- `:app` application, navigation, flavors `staging` and `production`

`settings.gradle.kts` includes the Android modules only when an Android SDK is present, so the JVM modules build anywhere.

## Commands

- `cd android && ./gradlew :core:vault:test` vault tests (no SDK needed)
- `./gradlew ktlintCheck detekt lintStagingDebug testStagingDebugUnitTest assembleStagingDebug` full check (needs the SDK; CI runs it)

## Releases

Tags `android-vX.Y.Z[-rc.N]` are built by `.github/workflows/android-release.yml`, never locally. See `docs/android-release.md`.
