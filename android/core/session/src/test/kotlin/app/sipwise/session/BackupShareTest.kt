package app.sipwise.session

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BackupShareTest {
    @Test
    fun namesTheFileByDate() {
        val share = encryptedBackupShare("{}", Instant.parse("2026-10-15T08:00:00Z"))
        assertEquals("sipwise-encrypted-backup-2026-10-15.json", share?.title)
        assertEquals("{}", share?.text)
    }

    @Test
    fun refusesWhatTheShareSheetCannotCarry() {
        assertNull(encryptedBackupShare("x".repeat(BACKUP_SHARE_LIMIT_CHARS + 1)))
    }
}
