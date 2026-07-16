package dev.aspex.glimmerlab.api

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Locks the client DTOs to the Hub's real wire format: the fixture in
 * `resources/state-snapshot.json` is a verbatim `GET /state` response
 * captured from the actual Hub (`buildApp` from `apps/hub/src/http/server.ts`
 * booted in-process with two representative signals). If the Hub's snapshot
 * shape changes, re-capture rather than hand-edit.
 */
class StateSnapshotTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun fixture(): StateSnapshot {
        val text = checkNotNull(javaClass.getResourceAsStream("/state-snapshot.json")) {
            "missing state-snapshot.json fixture"
        }.bufferedReader().use { it.readText() }
        return json.decodeFromString<StateSnapshot>(text)
    }

    @Test
    fun decodesRankedSnapshotFromRealHub() {
        val snapshot = fixture()

        assertEquals(2, snapshot.needsMe.size)
        assertTrue(snapshot.overflow.isEmpty())
        assertTrue(snapshot.ambient.isEmpty())

        // Hub ranking (RUNG in apps/hub/src/engine/attention.ts) puts
        // failing_ci ahead of review_requested regardless of severity; the
        // glance surface renders needsMe[0] verbatim and must not re-rank.
        val top = snapshot.needsMe.first()
        assertEquals("github:pr:DevRowe/Aspex:6", top.id)
        assertEquals("failing_ci", top.reason)
        assertEquals("medium", top.severity)
        assertEquals("Aspex", top.project)

        val rerun = top.actions.single()
        assertEquals("rerun", rerun.id)
        assertEquals(false, rerun.requiresConfirmation)
    }

    @Test
    fun consequentialActionCarriesConfirmationFlag() {
        val ship = fixture().needsMe
            .single { it.id == "orchestrator:giles:aspex-protocol-design-d1" }
            .actions.single { it.id == "ship" }

        assertEquals("Ship", ship.label)
        assertEquals("dangerous", ship.risk)
        assertTrue(ship.requiresConfirmation)
    }
}
