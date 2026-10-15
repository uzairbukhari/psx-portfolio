package app.sipwise.vault

import java.io.File
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class VaultCryptoTest {
    private val vault = VaultCrypto()
    private val vector: JsonObject = Json.parseToJsonElement(File(System.getProperty("sipwise.vectorFile")).readText()).jsonObject

    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonObject.obj(key: String) = getValue(key).jsonObject
    private fun hex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    private fun material(): VaultKeyMaterial {
        val m = vector.obj("material")
        val pw = m.obj("password")
        val kdf = pw.obj("kdf")
        val rec = m.obj("recovery")
        return VaultKeyMaterial(
            m.str("vaultId"), m.getValue("formatVersion").jsonPrimitive.int, m.getValue("keyVersion").jsonPrimitive.int, m.getValue("wrapperVersion").jsonPrimitive.int,
            PasswordWrapper(
                PasswordKdf(kdf.str("alg"), kdf.getValue("v").jsonPrimitive.int, kdf.getValue("m").jsonPrimitive.int, kdf.getValue("t").jsonPrimitive.int, kdf.getValue("p").jsonPrimitive.int),
                pw.str("salt"), pw.str("nonce"), pw.str("ct"),
            ),
            RecoveryWrapper(rec.str("nonce"), rec.str("ct")),
        )
    }

    @Test
    fun `password unwraps the data key written by the TypeScript client`() {
        assertContentEquals(hex(vector.str("dataKeyHex")), vault.unwrapWithPassword(material(), vector.str("password")))
    }

    @Test
    fun `recovery key unwraps the same data key, also when typed loosely`() {
        val expected = hex(vector.str("dataKeyHex"))
        assertContentEquals(expected, vault.unwrapWithRecovery(material(), vector.str("recoverySecret")))
        val typed = vector.str("recoverySecret").lowercase().replace('-', ' ').replace('0', 'o')
        assertContentEquals(expected, vault.unwrapWithRecovery(material(), typed))
    }

    @Test
    fun `envelope written by the TypeScript client decrypts`() {
        val e = vector.obj("envelope")
        val envelope = PortfolioEnvelope(
            e.getValue("v").jsonPrimitive.int, e.str("alg"), e.str("vaultId"), e.getValue("keyVersion").jsonPrimitive.int,
            e.getValue("revision").jsonPrimitive.int, e.str("nonce"), e.str("ct"),
        )
        val plain = vault.decryptPortfolio(hex(vector.str("dataKeyHex")), envelope, envelope.vaultId, envelope.keyVersion, envelope.revision)
        assertEquals(vector.str("plaintext"), plain)
    }

    @Test
    fun `envelope is bound to its revision`() {
        val e = vector.obj("envelope")
        val envelope = PortfolioEnvelope(1, "A256GCM", e.str("vaultId"), 1, 7, e.str("nonce"), e.str("ct"))
        val key = hex(vector.str("dataKeyHex"))
        assertEquals(VaultErrorCode.TAMPERED, assertFailsWith<VaultException> { vault.decryptPortfolio(key, envelope, envelope.vaultId, 1, 8) }.code)
        val moved = envelope.copy(revision = 8)
        assertEquals(VaultErrorCode.TAMPERED, assertFailsWith<VaultException> { vault.decryptPortfolio(key, moved, moved.vaultId, 1, 8) }.code)
    }

    @Test
    fun `wrong password and wrong recovery are distinguished`() {
        assertEquals(VaultErrorCode.WRONG_PASSWORD, assertFailsWith<VaultException> { vault.unwrapWithPassword(material(), "not the right passphrase at all") }.code)
        val secret = vector.str("recoverySecret")
        val flipped = secret.dropLast(1) + (if (secret.last() == '0') '1' else '0')
        assertEquals(VaultErrorCode.BAD_RECOVERY_FORMAT, assertFailsWith<VaultException> { vault.unwrapWithRecovery(material(), flipped) }.code)
        assertEquals(VaultErrorCode.BAD_RECOVERY_FORMAT, assertFailsWith<VaultException> { vault.unwrapWithRecovery(material(), "SIPW-ABCD") }.code)
    }

    @Test
    fun `weak passwords are refused and long ones count code points`() {
        assertEquals(VaultErrorCode.WEAK_PASSWORD, assertFailsWith<VaultException> { assertPasswordAcceptable("short") }.code)
        assertPasswordAcceptable("a".repeat(15))
    }

    @Test
    fun `create then unlock round trip, with fresh recovery text`() {
        val created = vault.createVaultKeys("a passphrase that is long enough")
        assertTrue(Regex("^SIPW(-[0-9A-Z]{4}){14}$").matches(created.recoverySecret))
        val material = created.material.copy(wrapperVersion = 1)
        validateVaultKeyMaterial(material)
        assertContentEquals(created.dataKey, vault.unwrapWithPassword(material, "a passphrase that is long enough"))
        assertContentEquals(created.dataKey, vault.unwrapWithRecovery(material, created.recoverySecret))
        val env = vault.encryptPortfolio(created.dataKey, material.vaultId, 1, 1, """{"marker":"SYNTH"}""")
        validateEnvelope(env)
        assertEquals("""{"marker":"SYNTH"}""", vault.decryptPortfolio(created.dataKey, env, material.vaultId, 1, 1))
    }

    @Test
    fun `kdf limits are enforced before any memory is used`() {
        val m = material()
        assertEquals(VaultErrorCode.UNSUPPORTED, assertFailsWith<VaultException> { assertKdfAllowed(m.password.kdf.copy(m = 1024)) }.code)
        assertEquals(VaultErrorCode.UNSUPPORTED, assertFailsWith<VaultException> { assertKdfAllowed(m.password.kdf.copy(m = 1 shl 20)) }.code)
        assertEquals(VaultErrorCode.UNSUPPORTED, assertFailsWith<VaultException> { assertKdfAllowed(m.password.kdf.copy(p = 2)) }.code)
    }

    @Test
    fun `base64url is strict`() {
        for (n in listOf(0, 1, 2, 3, 12, 16, 31, 32, 33)) {
            val bytes = DefaultCryptoProvider.randomBytes(n)
            assertContentEquals(bytes, fromB64u(toB64u(bytes)))
        }
        assertFailsWith<VaultException> { fromB64u("AB==") }
        assertFailsWith<VaultException> { fromB64u("AB") }
        assertFailsWith<VaultException> { fromB64u("A") }
    }
}
