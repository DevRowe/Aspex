package dev.aspex.glimmerlab.api

import kotlinx.serialization.Serializable

/**
 * Client-side mirror of the Hub's ranked snapshot (`GET /state` and the SSE
 * `state` event): `RankedView` + `generatedAt` from
 * `apps/hub/src/engine/attention.ts`. Only the fields this glance surface
 * renders are declared; everything else is ignored on decode.
 */
@Serializable
data class StateSnapshot(
    val needsMe: List<AttentionItem> = emptyList(),
    val overflow: List<AttentionItem> = emptyList(),
    val ambient: List<AttentionItem> = emptyList(),
    val generatedAt: String? = null,
)

/** Subset of `AttentionItem` in `packages/schema/src/types.ts`. */
@Serializable
data class AttentionItem(
    val id: String,
    val source: String,
    val project: String,
    val state: String,
    val severity: String,
    val summary: String,
    val reason: String = "ambient",
    val actions: List<HubAction> = emptyList(),
    val observedAt: String = "",
)

/** Subset of `Action` in `packages/schema/src/types.ts`. */
@Serializable
data class HubAction(
    val id: String,
    val label: String,
    val risk: String = "safe",
    val requiresConfirmation: Boolean = false,
)

/** Events surfaced by the Hub SSE stream connection. */
sealed interface HubEvent {
    data object Connected : HubEvent
    data class Snapshot(val state: StateSnapshot) : HubEvent
    data class Disconnected(val reason: String) : HubEvent
}

/** Outcome of `POST /actions/:itemId/:actionId`. */
sealed interface ActionOutcome {
    data class Success(val body: String) : ActionOutcome

    /**
     * The Hub's two-step confirmation gate: a consequential action answers
     * 409 until the same request is retried with `confirmed: true`.
     */
    data class NeedsConfirmation(val message: String) : ActionOutcome

    data class Failure(val code: Int, val message: String) : ActionOutcome
}

/** Outcome of `POST /intents` with a `status_query` verb. */
sealed interface StatusQueryOutcome {
    data class Report(val body: String) : StatusQueryOutcome
    data class Unavailable(val message: String) : StatusQueryOutcome
}
