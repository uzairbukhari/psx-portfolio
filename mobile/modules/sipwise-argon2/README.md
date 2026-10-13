# sipwise-argon2

Android-only Expo module that derives the vault's Argon2id key natively (Bouncy Castle `Argon2BytesGenerator`).
`lib/vault-crypto.ts` calls it through `CryptoAdapter.argon2id` (wired in `src/vault/crypto-setup.ts`) and falls back to
the pure-JS `@noble/hashes` derivation when the module is missing or throws, so every key derived either way is identical.

Parity: `Argon2Core.kt` has no Expo or Android types. Compiled and run on a plain JVM with Bouncy Castle bcprov-jdk15to18 1.81 it returns
`e105bdf0f06b3138c7241a99429bfec99c5ff06931f8dff6546b2d841b95070b` for password `password123`, salt `somesaltsomesalt`,
m=65536, t=3, p=1 (32 bytes, about 0.7 s), the same as `@noble`; `src/vault/vault.test.ts` pins that vector.

iOS is not built yet (`expo-module.config.json` lists android only); iOS uses the JS fallback.

Dependency note: use `bcprov-jdk15to18` at the version expo-updates uses. `bcprov-jdk18on` failed the first EAS release build with `Duplicate class org.bouncycastle...` (`:app:checkReleaseDuplicateClasses`). When expo-updates changes its Bouncy Castle version, align this one.
