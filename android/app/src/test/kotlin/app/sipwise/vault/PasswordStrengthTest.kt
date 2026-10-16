package app.sipwise.vault

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PasswordStrengthTest {
    @Test
    fun `empty password has no strength`() {
        assertEquals(Strength.NONE, checkPassword("", "a@b.co").strength)
    }

    @Test
    fun `short password is weak and not long enough`() {
        val check = checkPassword("hunter2", "a@b.co")
        assertEquals(Strength.WEAK, check.strength)
        assertFalse(check.longEnough)
    }

    @Test
    fun `four random words are strong`() {
        val check = checkPassword("river-lamp-cotton-ninety", "u@gmail.com")
        assertEquals(Strength.STRONG, check.strength)
        assertTrue(check.longEnough && check.notObvious)
    }

    @Test
    fun `a password containing the email name is obvious`() {
        val check = checkPassword("uzairbukhari-is-great-123", "uzairbukhari@gmail.com")
        assertFalse(check.notObvious)
        assertEquals(Strength.WEAK, check.strength)
    }

    @Test
    fun `a repeated character is obvious`() {
        assertFalse(checkPassword("aaaaaaaaaaaaaaaaaaaa", "x@y.zz").notObvious)
    }
}
