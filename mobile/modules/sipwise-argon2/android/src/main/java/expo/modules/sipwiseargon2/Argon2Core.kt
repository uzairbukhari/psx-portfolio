package expo.modules.sipwiseargon2

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters

// Pure JVM (no Expo or Android types) so it can be compiled and checked against @noble vectors on a plain JVM.
internal fun argon2idHex(passwordHex: String, saltHex: String, memoryKiB: Int, iterations: Int, parallelism: Int, length: Int): String {
  val password = fromHex(passwordHex)
  val salt = fromHex(saltHex)
  val params = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
    .withVersion(Argon2Parameters.ARGON2_VERSION_13)
    .withIterations(iterations)
    .withMemoryAsKB(memoryKiB)
    .withParallelism(parallelism)
    .withSalt(salt)
    .build()
  val generator = Argon2BytesGenerator()
  generator.init(params)
  val out = ByteArray(length)
  generator.generateBytes(password, out, 0, length)
  password.fill(0)
  return toHex(out)
}

private fun fromHex(hex: String): ByteArray {
  require(hex.length % 2 == 0) { "odd-length hex" }
  return ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
}

private fun toHex(bytes: ByteArray): String {
  val digits = "0123456789abcdef"
  val sb = StringBuilder(bytes.size * 2)
  for (b in bytes) {
    sb.append(digits[(b.toInt() shr 4) and 15]).append(digits[b.toInt() and 15])
  }
  return sb.toString()
}
