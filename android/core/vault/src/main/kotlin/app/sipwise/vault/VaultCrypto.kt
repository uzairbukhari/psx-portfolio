package app.sipwise.vault

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

// Port of lib/vault-crypto.ts. The on-wire format must stay byte-identical: the web app and the Expo app read what
// this code writes and the other way round. tests/fixtures/vault-vector.json (written by the TypeScript tests) is
// decrypted in VaultCryptoTest, so a drift fails CI.

object VaultFormat {
    const val VAULT_FORMAT_VERSION = 1
    const val ENVELOPE_VERSION = 1
    const val ENVELOPE_ALG = "A256GCM"
    const val KDF_ALG = "argon2id"

    /** Argon2 version 0x13. */
    const val KDF_VERSION = 19
    const val KDF_M = 65536
    const val KDF_T = 3
    const val KDF_P = 1
    const val KDF_M_MIN = 65536
    const val KDF_M_MAX = 131072
    const val KDF_T_MIN = 3
    const val KDF_T_MAX = 6
    const val NONCE_BYTES = 12
    const val TAG_BYTES = 16
    const val KEY_BYTES = 32
    const val SALT_BYTES = 16
    const val VAULT_ID_BYTES = 16
    const val MIN_PASSWORD_CHARS = 15
    const val MAX_PASSWORD_CHARS = 1024
    const val MAX_PLAINTEXT_BYTES = 4_000_000
}

enum class VaultErrorCode {
    WEAK_PASSWORD,
    WRONG_PASSWORD,
    WRONG_RECOVERY,
    BAD_RECOVERY_FORMAT,
    TAMPERED,
    UNSUPPORTED,
    INVALID,
    TOO_LARGE,
}

class VaultException(
    val code: VaultErrorCode,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

/** Randomness and the key derivation, injectable so tests can be deterministic and the app can swap in native code. */
interface CryptoProvider {
    fun randomBytes(length: Int): ByteArray

    fun argon2id(
        password: ByteArray,
        salt: ByteArray,
        memoryKiB: Int,
        iterations: Int,
        parallelism: Int,
        length: Int,
    ): ByteArray
}

object DefaultCryptoProvider : CryptoProvider {
    private val random = SecureRandom()

    override fun randomBytes(length: Int): ByteArray = ByteArray(length).also(random::nextBytes)

    override fun argon2id(
        password: ByteArray,
        salt: ByteArray,
        memoryKiB: Int,
        iterations: Int,
        parallelism: Int,
        length: Int,
    ): ByteArray {
        val params =
            Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
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
        return out
    }
}

// ---- Encoding -----------------------------------------------------------------------------------------------

private val B64_PATTERN = Regex("^[A-Za-z0-9_-]*$")

/** base64url without padding. */
fun toB64u(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

/** Strict decode: rejects stray characters, impossible lengths and non-canonical text (one ciphertext, one text form). */
fun fromB64u(text: String): ByteArray {
    if (!B64_PATTERN.matches(text) || text.length % 4 == 1) throw VaultException(VaultErrorCode.INVALID, "Invalid encoding.")
    val out =
        try {
            Base64.getUrlDecoder().decode(text)
        } catch (e: IllegalArgumentException) {
            throw VaultException(VaultErrorCode.INVALID, "Invalid encoding.", e)
        }
    if (toB64u(out) != text) throw VaultException(VaultErrorCode.INVALID, "Invalid encoding.")
    return out
}

fun b64uLength(bytes: Int): Int = (bytes * 4 + 2) / 3

private fun utf8(text: String): ByteArray = text.toByteArray(Charsets.UTF_8)

// ---- Shapes -------------------------------------------------------------------------------------------------

data class PasswordKdf(val alg: String, val v: Int, val m: Int, val t: Int, val p: Int)

data class PasswordWrapper(val kdf: PasswordKdf, val salt: String, val nonce: String, val ct: String)

data class RecoveryWrapper(val nonce: String, val ct: String)

data class VaultKeyMaterial(
    val vaultId: String,
    val formatVersion: Int,
    val keyVersion: Int,
    val wrapperVersion: Int,
    val password: PasswordWrapper,
    val recovery: RecoveryWrapper,
)

data class PortfolioEnvelope(
    val v: Int,
    val alg: String,
    val vaultId: String,
    val keyVersion: Int,
    val revision: Int,
    val nonce: String,
    val ct: String,
)

class NewVault(
    val dataKey: ByteArray,
    val recoverySecret: String,
    val material: VaultKeyMaterial,
)

private val VAULT_ID_PATTERN = Regex("^[A-Za-z0-9_-]{22}$")

private fun isB64Len(
    value: String,
    bytes: Int,
) = value.length == b64uLength(bytes) && B64_PATTERN.matches(value)

private fun invalid(message: String): Nothing = throw VaultException(VaultErrorCode.INVALID, message)

fun assertKdfAllowed(kdf: PasswordKdf) {
    if (kdf.alg != VaultFormat.KDF_ALG || kdf.v != VaultFormat.KDF_VERSION) throw VaultException(VaultErrorCode.UNSUPPORTED, "Unsupported key derivation settings.")
    if (kdf.m < 0 || kdf.t < 0 || kdf.p < 0) invalid("Invalid key derivation settings.")
    if (kdf.m < VaultFormat.KDF_M_MIN || kdf.t < VaultFormat.KDF_T_MIN || kdf.p != VaultFormat.KDF_P) {
        throw VaultException(VaultErrorCode.UNSUPPORTED, "Key derivation settings are weaker than this app allows.")
    }
    if (kdf.m > VaultFormat.KDF_M_MAX || kdf.t > VaultFormat.KDF_T_MAX) {
        throw VaultException(VaultErrorCode.UNSUPPORTED, "Key derivation settings are too expensive for this app.")
    }
}

fun validateEnvelope(
    e: PortfolioEnvelope,
    maxCtBytes: Int = VaultFormat.MAX_PLAINTEXT_BYTES + VaultFormat.TAG_BYTES,
) {
    if (e.v != VaultFormat.ENVELOPE_VERSION || e.alg != VaultFormat.ENVELOPE_ALG) throw VaultException(VaultErrorCode.UNSUPPORTED, "Unsupported encrypted portfolio format.")
    if (!VAULT_ID_PATTERN.matches(e.vaultId) || e.keyVersion < 1 || e.revision < 0) invalid("Invalid encrypted portfolio.")
    if (!isB64Len(e.nonce, VaultFormat.NONCE_BYTES)) invalid("Invalid encrypted portfolio.")
    if (!ciphertextShapeOk(e.ct, maxCtBytes)) invalid("Invalid encrypted portfolio.")
}

fun validateVaultKeyMaterial(m: VaultKeyMaterial) {
    if (m.formatVersion != VaultFormat.VAULT_FORMAT_VERSION) throw VaultException(VaultErrorCode.UNSUPPORTED, "Unsupported vault format.")
    if (!VAULT_ID_PATTERN.matches(m.vaultId) || m.keyVersion < 1 || m.wrapperVersion < 0) invalid("Invalid vault.")
    assertKdfAllowed(m.password.kdf)
    val wrapped = VaultFormat.KEY_BYTES + VaultFormat.TAG_BYTES
    if (!isB64Len(m.password.salt, VaultFormat.SALT_BYTES) || !isB64Len(m.password.nonce, VaultFormat.NONCE_BYTES) || !isB64Len(m.password.ct, wrapped)) invalid("Invalid vault.")
    if (!isB64Len(m.recovery.nonce, VaultFormat.NONCE_BYTES) || !isB64Len(m.recovery.ct, wrapped)) invalid("Invalid vault.")
}

// ---- Authenticated metadata -------------------------------------------------------------------------------

enum class Purpose(val wire: String) { PORTFOLIO("portfolio"), WRAP_PASSWORD("wrap-password"), WRAP_RECOVERY("wrap-recovery") }

/** The one deterministic AAD encoding both clients use: `|`-joined ASCII fields. */
fun aadFor(
    purpose: Purpose,
    vaultId: String,
    keyVersion: Int,
    revision: Int = 0,
    kdf: PasswordKdf? = null,
    salt: String? = null,
): ByteArray {
    val parts = mutableListOf("sipwise-vault", "v${VaultFormat.ENVELOPE_VERSION}", purpose.wire, vaultId, "k$keyVersion")
    if (purpose == Purpose.PORTFOLIO) parts += "r$revision"
    if (purpose == Purpose.WRAP_PASSWORD) {
        if (kdf == null || salt == null) invalid("Missing key derivation parameters.")
        parts += listOf(kdf.alg, "${kdf.v}", "m${kdf.m}", "t${kdf.t}", "p${kdf.p}", salt)
    }
    return utf8(parts.joinToString("|"))
}

// ---- Primitives ---------------------------------------------------------------------------------------------

private fun hmacSha256(
    key: ByteArray,
    data: ByteArray,
): ByteArray =
    Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(data)
    }

/** HKDF-SHA256 with an absent salt (HashLen zero bytes, as @noble does) producing one block (`length` ≤ 32). */
private fun hkdfSha256(
    ikm: ByteArray,
    info: ByteArray,
    length: Int,
): ByteArray {
    require(length in 1..32)
    val prk = hmacSha256(ByteArray(32), ikm)
    val block = hmacSha256(prk, info + byteArrayOf(1))
    return block.copyOf(length)
}

private fun aesGcmEncrypt(
    key: ByteArray,
    nonce: ByteArray,
    aad: ByteArray,
    plaintext: ByteArray,
): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(VaultFormat.TAG_BYTES * 8, nonce))
    cipher.updateAAD(aad)
    return cipher.doFinal(plaintext)
}

private fun aesGcmDecrypt(
    key: ByteArray,
    nonce: ByteArray,
    aad: ByteArray,
    ciphertext: ByteArray,
): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(VaultFormat.TAG_BYTES * 8, nonce))
    cipher.updateAAD(aad)
    return cipher.doFinal(ciphertext)
}

// ---- Password and recovery secret ---------------------------------------------------------------------------

/** NFKC-normalised, so the same typed password derives the same key on every keyboard and platform. */
fun normalizePassword(password: String): String = Normalizer.normalize(password, Normalizer.Form.NFKC)

fun assertPasswordAcceptable(password: String) {
    val length = normalizePassword(password).codePointCount(0, normalizePassword(password).length)
    if (length < VaultFormat.MIN_PASSWORD_CHARS) {
        throw VaultException(VaultErrorCode.WEAK_PASSWORD, "Use at least ${VaultFormat.MIN_PASSWORD_CHARS} characters. A generated passphrase of several random words works well.")
    }
    if (length > VaultFormat.MAX_PASSWORD_CHARS) throw VaultException(VaultErrorCode.WEAK_PASSWORD, "Use at most ${VaultFormat.MAX_PASSWORD_CHARS} characters.")
}

private const val PASSWORD_WRAP_INFO = "sipwise-vault/v1/password-wrap-key"
private const val RECOVERY_WRAP_INFO = "sipwise-vault/v1/recovery-wrap-key"

private fun passwordKey(
    crypto: CryptoProvider,
    password: String,
    kdf: PasswordKdf,
    salt: ByteArray,
): ByteArray {
    assertKdfAllowed(kdf)
    val input = utf8(normalizePassword(password))
    val raw = crypto.argon2id(input, salt, kdf.m, kdf.t, kdf.p, VaultFormat.KEY_BYTES)
    input.fill(0)
    return hkdfSha256(raw, utf8(PASSWORD_WRAP_INFO), VaultFormat.KEY_BYTES).also { raw.fill(0) }
}

private fun recoveryKey(secret: ByteArray) = hkdfSha256(secret, utf8(RECOVERY_WRAP_INFO), VaultFormat.KEY_BYTES)

private const val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
private const val RECOVERY_PREFIX = "SIPW"
private const val CHECKSUM_CHARS = 4

private fun base32(bytes: ByteArray): String {
    var bits = 0
    var acc = 0
    val out = StringBuilder()
    for (byte in bytes) {
        acc = (acc shl 8) or (byte.toInt() and 0xff)
        bits += 8
        while (bits >= 5) {
            out.append(CROCKFORD[(acc shr (bits - 5)) and 31])
            bits -= 5
        }
        acc = acc and ((1 shl bits) - 1)
    }
    if (bits > 0) out.append(CROCKFORD[(acc shl (5 - bits)) and 31])
    return out.toString()
}

private fun unbase32(
    text: String,
    bytes: Int,
): ByteArray {
    val out = ByteArray(bytes)
    var bits = 0
    var acc = 0
    var o = 0
    for (ch in text) {
        val value = CROCKFORD.indexOf(ch)
        if (value < 0) throw VaultException(VaultErrorCode.BAD_RECOVERY_FORMAT, "The recovery key has an invalid character.")
        acc = (acc shl 5) or value
        bits += 5
        if (bits >= 8) {
            if (o < bytes) out[o++] = ((acc shr (bits - 8)) and 255).toByte()
            bits -= 8
            acc = acc and ((1 shl bits) - 1)
        }
    }
    return out
}

private fun checksum(secret: ByteArray): String =
    base32(MessageDigest.getInstance("SHA-256").digest(utf8("sipwise-recovery-checksum/v1") + secret)).take(CHECKSUM_CHARS)

/** `SIPW-XXXX-XXXX-…` (52 secret characters + 4 checksum characters, Crockford base32, groups of four). */
fun encodeRecoverySecret(secret: ByteArray): String {
    if (secret.size != VaultFormat.KEY_BYTES) invalid("Invalid recovery secret.")
    val body = base32(secret) + checksum(secret)
    return "$RECOVERY_PREFIX-" + body.chunked(4).joinToString("-")
}

/** Parses what a person typed or pasted. Tolerates case, spaces, dashes and the usual I/L/O look-alikes. */
fun decodeRecoverySecret(text: String): ByteArray {
    var clean = text.uppercase().replace(Regex("[\\s-]+"), "")
    if (clean.startsWith(RECOVERY_PREFIX)) clean = clean.substring(RECOVERY_PREFIX.length)
    clean = clean.replace('O', '0').replace('I', '1').replace('L', '1')
    val secretChars = (VaultFormat.KEY_BYTES * 8 + 4) / 5
    if (clean.length != secretChars + CHECKSUM_CHARS) {
        throw VaultException(VaultErrorCode.BAD_RECOVERY_FORMAT, "The recovery key is the wrong length. Check that all of it was copied.")
    }
    val secret = unbase32(clean.substring(0, secretChars), VaultFormat.KEY_BYTES)
    if (checksum(secret) != clean.substring(secretChars)) {
        throw VaultException(VaultErrorCode.BAD_RECOVERY_FORMAT, "The recovery key has a typing mistake. Check it against your saved copy.")
    }
    return secret
}

// ---- Key wrapping -------------------------------------------------------------------------------------------

private class Sealed(val nonce: String, val ct: String)

private fun sealKey(
    crypto: CryptoProvider,
    wrapKey: ByteArray,
    aad: ByteArray,
    dataKey: ByteArray,
): Sealed {
    val nonce = crypto.randomBytes(VaultFormat.NONCE_BYTES)
    return Sealed(toB64u(nonce), toB64u(aesGcmEncrypt(wrapKey, nonce, aad, dataKey)))
}

private fun openKey(
    wrapKey: ByteArray,
    aad: ByteArray,
    nonce: String,
    ct: String,
    fail: VaultErrorCode,
): ByteArray {
    val key =
        try {
            aesGcmDecrypt(wrapKey, fromB64u(nonce), aad, fromB64u(ct))
        } catch (e: Exception) {
            val message = if (fail == VaultErrorCode.WRONG_PASSWORD) "That password is not correct." else "That recovery key is not correct."
            throw VaultException(fail, message, e)
        }
    if (key.size != VaultFormat.KEY_BYTES) throw VaultException(fail, "That key is not correct.")
    return key
}

class VaultCrypto(private val crypto: CryptoProvider = DefaultCryptoProvider) {
    fun wrapWithPassword(
        dataKey: ByteArray,
        vaultId: String,
        keyVersion: Int,
        password: String,
    ): PasswordWrapper {
        assertPasswordAcceptable(password)
        val kdf = PasswordKdf(VaultFormat.KDF_ALG, VaultFormat.KDF_VERSION, VaultFormat.KDF_M, VaultFormat.KDF_T, VaultFormat.KDF_P)
        val salt = toB64u(crypto.randomBytes(VaultFormat.SALT_BYTES))
        val key = passwordKey(crypto, password, kdf, fromB64u(salt))
        val sealed = sealKey(crypto, key, aadFor(Purpose.WRAP_PASSWORD, vaultId, keyVersion, kdf = kdf, salt = salt), dataKey)
        key.fill(0)
        return PasswordWrapper(kdf, salt, sealed.nonce, sealed.ct)
    }

    /** Returns the wrapper and the one-time recovery text for the person to save. */
    fun wrapWithRecovery(
        dataKey: ByteArray,
        vaultId: String,
        keyVersion: Int,
    ): Pair<RecoveryWrapper, String> {
        val secret = crypto.randomBytes(VaultFormat.KEY_BYTES)
        val key = recoveryKey(secret)
        val sealed = sealKey(crypto, key, aadFor(Purpose.WRAP_RECOVERY, vaultId, keyVersion), dataKey)
        val text = encodeRecoverySecret(secret)
        key.fill(0)
        secret.fill(0)
        return RecoveryWrapper(sealed.nonce, sealed.ct) to text
    }

    fun unwrapWithPassword(
        material: VaultKeyMaterial,
        password: String,
    ): ByteArray {
        validateVaultKeyMaterial(material)
        val w = material.password
        val key = passwordKey(crypto, password, w.kdf, fromB64u(w.salt))
        try {
            return openKey(key, aadFor(Purpose.WRAP_PASSWORD, material.vaultId, material.keyVersion, kdf = w.kdf, salt = w.salt), w.nonce, w.ct, VaultErrorCode.WRONG_PASSWORD)
        } finally {
            key.fill(0)
        }
    }

    fun unwrapWithRecovery(
        material: VaultKeyMaterial,
        recoverySecret: String,
    ): ByteArray {
        validateVaultKeyMaterial(material)
        val secret = decodeRecoverySecret(recoverySecret)
        val key = recoveryKey(secret)
        try {
            return openKey(key, aadFor(Purpose.WRAP_RECOVERY, material.vaultId, material.keyVersion), material.recovery.nonce, material.recovery.ct, VaultErrorCode.WRONG_RECOVERY)
        } finally {
            key.fill(0)
            secret.fill(0)
        }
    }

    /** Generates a new vault: random id and data key, password wrapper, recovery wrapper and recovery secret. */
    fun createVaultKeys(password: String): NewVault {
        assertPasswordAcceptable(password)
        val vaultId = toB64u(crypto.randomBytes(VaultFormat.VAULT_ID_BYTES))
        val keyVersion = 1
        val dataKey = crypto.randomBytes(VaultFormat.KEY_BYTES)
        val passwordWrapper = wrapWithPassword(dataKey, vaultId, keyVersion, password)
        val (recoveryWrapper, recoverySecret) = wrapWithRecovery(dataKey, vaultId, keyVersion)
        return NewVault(dataKey, recoverySecret, VaultKeyMaterial(vaultId, VaultFormat.VAULT_FORMAT_VERSION, keyVersion, 0, passwordWrapper, recoveryWrapper))
    }

    /** Encrypts for `revision` (the revision this ciphertext will be stored at). */
    fun encryptPortfolio(
        dataKey: ByteArray,
        vaultId: String,
        keyVersion: Int,
        revision: Int,
        plaintext: String,
    ): PortfolioEnvelope {
        val bytes = utf8(plaintext)
        if (bytes.size > VaultFormat.MAX_PLAINTEXT_BYTES) throw VaultException(VaultErrorCode.TOO_LARGE, "Portfolio file is too large.")
        val nonce = crypto.randomBytes(VaultFormat.NONCE_BYTES)
        val ct = aesGcmEncrypt(dataKey, nonce, aadFor(Purpose.PORTFOLIO, vaultId, keyVersion, revision), bytes)
        return PortfolioEnvelope(VaultFormat.ENVELOPE_VERSION, VaultFormat.ENVELOPE_ALG, vaultId, keyVersion, revision, toB64u(nonce), toB64u(ct))
    }

    /** Decrypts and authenticates. `expected` pins the vault, key version and the revision the server reported. */
    fun decryptPortfolio(
        dataKey: ByteArray,
        envelope: PortfolioEnvelope,
        expectedVaultId: String,
        expectedKeyVersion: Int,
        expectedRevision: Int,
    ): String {
        validateEnvelope(envelope)
        if (envelope.vaultId != expectedVaultId || envelope.keyVersion != expectedKeyVersion || envelope.revision != expectedRevision) {
            throw VaultException(VaultErrorCode.TAMPERED, "The encrypted portfolio does not match this vault.")
        }
        try {
            val plain = aesGcmDecrypt(dataKey, fromB64u(envelope.nonce), aadFor(Purpose.PORTFOLIO, envelope.vaultId, envelope.keyVersion, envelope.revision), fromB64u(envelope.ct))
            return String(plain, Charsets.UTF_8)
        } catch (e: Exception) {
            throw VaultException(VaultErrorCode.TAMPERED, "The encrypted portfolio could not be verified. It may be damaged or belong to another vault.", e)
        }
    }
}

private fun ciphertextShapeOk(
    ct: String,
    maxCtBytes: Int,
): Boolean {
    val lengthOk = ct.length <= b64uLength(maxCtBytes) && ct.length >= b64uLength(VaultFormat.TAG_BYTES)
    return lengthOk && B64_PATTERN.matches(ct) && ct.length % 4 != 1
}
