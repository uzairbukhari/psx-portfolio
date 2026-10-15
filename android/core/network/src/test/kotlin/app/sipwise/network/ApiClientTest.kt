package app.sipwise.network

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class ApiClientTest {
    private val server = MockWebServer().apply { start() }
    private var unauthorized = 0

    private fun client(token: String? = "tok") =
        ApiClient(server.url("/").toString(), { token }, onUnauthorized = { unauthorized++ })

    @AfterTest
    fun stop() = server.shutdown()

    @Test
    fun sendsBearerTokenAndParsesJson() =
        runTest {
            server.enqueue(MockResponse().setBody("""{"email":"a@b.c","name":null,"picture":null,"role":"user","extra":1}"""))
            val me = client().get("/api/me", MeResponse.serializer())
            assertEquals("a@b.c", me.email)
            val recorded = server.takeRequest()
            assertEquals("Bearer tok", recorded.getHeader("Authorization"))
            assertEquals("/api/me", recorded.path)
        }

    @Test
    fun unauthedPostSendsNoTokenAndJsonBody() =
        runTest {
            server.enqueue(MockResponse().setBody("""{"token":"t","user":{"email":"a@b.c"}}"""))
            val r =
                client().post(
                    "/api/auth/mobile/google",
                    MobileSignInRequest("idt", platform = "android"),
                    MobileSignInRequest.serializer(),
                    MobileSignInResponse.serializer(),
                    authed = false,
                )
            assertEquals("t", r.token)
            val recorded = server.takeRequest()
            assertNull(recorded.getHeader("Authorization"))
            assertEquals("""{"idToken":"idt","platform":"android"}""", recorded.body.readUtf8())
        }

    @Test
    fun serverErrorKeepsMessageAndCode() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(426).setBody("""{"error":"Update the app.","code":"upgrade-required"}"""))
            val e = assertFailsWith<ApiRequestException> { client().get("/api/x", MeResponse.serializer()) }
            assertEquals(426, e.status)
            assertEquals("upgrade-required", e.code)
            assertEquals("Update the app.", e.message)
        }

    @Test
    fun unauthorizedTriggersCallbackOnlyWhenAuthed() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"no"}"""))
            assertFailsWith<ApiRequestException> { client().get("/api/me", MeResponse.serializer()) }
            assertEquals(1, unauthorized)
        }

    @Test
    fun cloudflarePageBecomesFriendlyMessage() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(503).setBody("<html>Error 1102 exceeded resource limits</html>"))
            val e = assertFailsWith<ApiRequestException> { client().get("/api/me", MeResponse.serializer()) }
            assertEquals("cf_worker_limit", e.code)
            assertEquals(PlatformCode.WORKER_LIMIT.message, e.message)
        }

    @Test
    fun networkFailureIsStatusZero() =
        runTest {
            val c = client()
            server.shutdown()
            val e = assertFailsWith<ApiRequestException> { c.get("/api/me", MeResponse.serializer()) }
            assertEquals(0, e.status)
        }

    @Test
    fun classifierMatchesTypeScript() {
        assertNull(classifyPlatformResponse(200, "x"))
        assertNull(classifyPlatformResponse(500, """{"error":"app"}"""))
        assertEquals(PlatformCode.RATE_LIMITED, classifyPlatformResponse(429, "nope"))
        assertEquals(PlatformCode.TIMEOUT, classifyPlatformResponse(524, "x"))
        assertEquals(PlatformCode.UNAVAILABLE, classifyPlatformResponse(502, "bad gateway"))
        assertEquals(PlatformCode.DAILY_LIMIT, classifyPlatformResponse(503, "Error 1027"))
    }
}
