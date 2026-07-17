package dev.aspex.glimmerlab.api

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Locks the `/actions/:itemId/:actionId` path construction: ids must be
 * percent-encoded per segment because GitHub item ids carry `/` (owner/repo).
 * An unencoded id splits into an extra path segment and the Hub answers 404.
 */
class ActionPathTest {
    @Test
    fun slashBearingGithubItemIdStaysOneSegment() {
        assertEquals(
            "/actions/github%3Apr%3ADevRowe%2FAspex%3A6/rerun",
            actionPath("github:pr:DevRowe/Aspex:6", "rerun"),
        )
    }

    @Test
    fun orchestratorItemIdRoundTripsUnharmed() {
        assertEquals(
            "/actions/orchestrator%3Agiles%3Aaspex-protocol-design-d1/ship",
            actionPath("orchestrator:giles:aspex-protocol-design-d1", "ship"),
        )
    }

    @Test
    fun spacesEncodeAsPercent20NotPlus() {
        assertEquals("/actions/a%20b/c%2Fd", actionPath("a b", "c/d"))
    }
}
