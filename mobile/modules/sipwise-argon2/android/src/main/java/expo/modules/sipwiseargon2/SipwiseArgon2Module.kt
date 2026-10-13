package expo.modules.sipwiseargon2

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Argon2id for the vault password. The JS side (lib/vault-crypto.ts) hands over the already NFKC-normalised UTF-8
// password and the salt as hex and derives the same 32 bytes the pure-JS @noble implementation does, in about a
// second instead of about a minute. Hex keeps the bridge free of binary-array support differences between SDKs.
class SipwiseArgon2Module : Module() {
  override fun definition() = ModuleDefinition {
    Name("SipwiseArgon2")

    // AsyncFunction runs off the main thread, so the UI stays responsive while Argon2 works.
    AsyncFunction("argon2id") { passwordHex: String, saltHex: String, memoryKiB: Int, iterations: Int, parallelism: Int, length: Int ->
      try {
        argon2idHex(passwordHex, saltHex, memoryKiB, iterations, parallelism, length)
      } catch (e: Throwable) {
        // OutOfMemoryError is an Error, not an Exception: surface it so JS can fall back instead of crashing.
        throw CodedException("ERR_ARGON2", e.message ?: e.javaClass.simpleName, e)
      }
    }
  }
}
