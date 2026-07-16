package dev.aspex.glimmerlab.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Locks the HTTP-200-but-failed detection: the Hub answers 200 with
 * `{ok:false, message}` for adapter-level failures (no adapter for source,
 * unknown action, failed adapter runAction - apps/hub/src/adapters
 * /registry.ts), and its intent ledger records only ok:true entries, so the
 * client must surface these as failures the user can retry.
 */
class AdapterFailureMessageTest {
    @Test
    fun okFalseBodyYieldsItsMessage() {
        assertEquals(
            "No adapter for item source",
            adapterFailureMessage("""{"ok":false,"message":"No adapter for item source"}"""),
        )
    }

    @Test
    fun okFalseWithoutMessageStillFails() {
        assertEquals("action failed", adapterFailureMessage("""{"ok":false}"""))
    }

    @Test
    fun okTrueBodyIsNotAFailure() {
        assertNull(adapterFailureMessage("""{"ok":true,"message":"Rerun requested"}"""))
    }

    @Test
    fun bodyWithoutOkFieldIsNotAFailure() {
        assertNull(adapterFailureMessage("""{"message":"queued"}"""))
    }

    @Test
    fun unparseableBodyIsNotAFailure() {
        assertNull(adapterFailureMessage("not json"))
    }
}
