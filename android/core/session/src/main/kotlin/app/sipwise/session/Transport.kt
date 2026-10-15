package app.sipwise.session

import app.sipwise.network.ApiClient
import app.sipwise.vault.PasswordWrapper
import app.sipwise.vault.PortfolioEnvelope
import app.sipwise.vault.RecoveryWrapper
import app.sipwise.vault.VaultKeyMaterial
import kotlinx.serialization.Serializable

/** Wire shapes of /api/vault and /api/v3/portfolio (lib/api-types.ts). */
@Serializable
data class VaultResponse(val vault: VaultKeyMaterial? = null)

@Serializable
data class VaultSetupRequest(val material: VaultKeyMaterial, val envelope: PortfolioEnvelope)

@Serializable
data class VaultSetupResponse(val vault: VaultKeyMaterial, val revision: Int)

@Serializable
data class VaultWrappersRequest(
    val expectedWrapperVersion: Int,
    val password: PasswordWrapper? = null,
    val recovery: RecoveryWrapper? = null,
)

@Serializable
data class VaultWrappersResponse(val wrapperVersion: Int)

@Serializable
data class VaultDeleteRequest(val confirm: Boolean = true)

@Serializable
data class EncryptedPortfolioResponse(
    val vaultId: String,
    val revision: Int,
    val envelope: PortfolioEnvelope,
    val updatedAt: String,
)

@Serializable
data class SaveEncryptedPortfolioRequest(val envelope: PortfolioEnvelope, val expectedRevision: Int)

@Serializable
data class SaveEncryptedPortfolioResponse(val revision: Int)

@Serializable
private data class Empty(val ok: Boolean? = null)

/** HTTP-level access to the vault. `ApiRequestException.status == 0` means the server could not be reached. */
interface VaultTransport {
    suspend fun getVault(): VaultResponse

    suspend fun postVault(request: VaultSetupRequest): VaultSetupResponse

    suspend fun putWrappers(request: VaultWrappersRequest): VaultWrappersResponse

    suspend fun deleteVault()

    suspend fun getPortfolio(): EncryptedPortfolioResponse

    suspend fun putPortfolio(request: SaveEncryptedPortfolioRequest): SaveEncryptedPortfolioResponse
}

class ApiVaultTransport(private val api: ApiClient) : VaultTransport {
    override suspend fun getVault() = api.get("/api/vault", VaultResponse.serializer())

    override suspend fun postVault(request: VaultSetupRequest) =
        api.post("/api/vault", request, VaultSetupRequest.serializer(), VaultSetupResponse.serializer())

    override suspend fun putWrappers(request: VaultWrappersRequest) =
        api.put("/api/vault", request, VaultWrappersRequest.serializer(), VaultWrappersResponse.serializer())

    override suspend fun deleteVault() {
        api.delete("/api/vault", VaultDeleteRequest(), VaultDeleteRequest.serializer(), Empty.serializer())
    }

    override suspend fun getPortfolio() = api.get("/api/v3/portfolio", EncryptedPortfolioResponse.serializer())

    override suspend fun putPortfolio(request: SaveEncryptedPortfolioRequest) =
        api.put("/api/v3/portfolio", request, SaveEncryptedPortfolioRequest.serializer(), SaveEncryptedPortfolioResponse.serializer())
}

/** What a device may keep to unlock offline: ciphertext and wrappers only. Never keys, passwords or plaintext. */
@Serializable
data class CachedVault(val vault: VaultKeyMaterial, val portfolio: EncryptedPortfolioResponse? = null)

interface VaultCache {
    suspend fun read(): CachedVault?

    suspend fun write(value: CachedVault)

    suspend fun clear()
}

object NoCache : VaultCache {
    override suspend fun read(): CachedVault? = null

    override suspend fun write(value: CachedVault) = Unit

    override suspend fun clear() = Unit
}
