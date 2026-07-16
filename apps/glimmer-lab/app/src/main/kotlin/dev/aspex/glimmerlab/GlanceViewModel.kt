package dev.aspex.glimmerlab

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dev.aspex.glimmerlab.api.ActionOutcome
import dev.aspex.glimmerlab.api.AttentionItem
import dev.aspex.glimmerlab.api.HubAction
import dev.aspex.glimmerlab.api.HubClient
import dev.aspex.glimmerlab.api.HubEvent
import dev.aspex.glimmerlab.api.StatusQueryOutcome
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class ConnectionState { CONNECTING, LIVE, LOST }

/**
 * Two-step confirm mirrored off the Hub's 409 gate: the first tap POSTs the
 * action unconfirmed; a 409 moves to [AwaitingConfirmation]; the second tap
 * retries with `confirmed: true` and the same intentId.
 */
sealed interface ConfirmFlow {
    data object Idle : ConfirmFlow

    data class AwaitingConfirmation(
        val item: AttentionItem,
        val action: HubAction,
        val intentId: String,
        /**
         * Set when a confirmed attempt failed ambiguously; the flow stays here
         * with the same intentId so the retry replays through the Hub's intent
         * ledger instead of re-running the action under a fresh id.
         */
        val failureNote: String? = null,
    ) : ConfirmFlow

    data class InFlight(val label: String) : ConfirmFlow

    /** Transient acknowledgement; cleared back to [Idle] after a beat. */
    data class Notice(val message: String) : ConfirmFlow
}

data class GlanceUiState(
    val connection: ConnectionState = ConnectionState.CONNECTING,
    val disconnectReason: String? = null,
    /** Highest-ranked needs-me item; the single unit this surface renders. */
    val top: AttentionItem? = null,
    val needsMeCount: Int = 0,
    val confirm: ConfirmFlow = ConfirmFlow.Idle,
    val statusLine: String? = null,
)

class GlanceViewModel(
    private val client: HubClient = HubClient(BuildConfig.ASPEX_HUB_URL, BuildConfig.ASPEX_HUB_TOKEN),
) : ViewModel() {
    private val _uiState = MutableStateFlow(GlanceUiState())
    val uiState: StateFlow<GlanceUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch { streamForever() }
    }

    private suspend fun streamForever() {
        var backoffMs = 1_000L
        while (true) {
            try {
                client.stateStream().collect { event ->
                    when (event) {
                        is HubEvent.Connected -> {
                            backoffMs = 1_000L
                            _uiState.update {
                                it.copy(connection = ConnectionState.LIVE, disconnectReason = null)
                            }
                        }

                        is HubEvent.Snapshot -> _uiState.update {
                            val top = event.state.needsMe.firstOrNull()
                            it.copy(
                                top = top,
                                needsMeCount = event.state.needsMe.size,
                                // Drop a pending confirmation whenever its item is
                                // no longer needsMe[0]: on a one-card surface the
                                // visible card IS the referent, so a confirmation
                                // is only valid while its item is the rendered top
                                // item.
                                confirm = when (val confirm = it.confirm) {
                                    is ConfirmFlow.AwaitingConfirmation ->
                                        if (confirm.item.id == top?.id) confirm else ConfirmFlow.Idle

                                    else -> confirm
                                },
                            )
                        }

                        is HubEvent.Disconnected -> _uiState.update {
                            it.copy(connection = ConnectionState.LOST, disconnectReason = event.reason)
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        connection = ConnectionState.LOST,
                        disconnectReason = e.message ?: e.javaClass.simpleName,
                    )
                }
            }

            delay(backoffMs)
            backoffMs = (backoffMs * 2).coerceAtMost(30_000L)
        }
    }

    /** Primary-action tap (temple tap / emulator touchpad click). */
    fun onPrimaryAction() {
        val state = _uiState.value
        val confirm = state.confirm
        if (confirm is ConfirmFlow.InFlight) return

        viewModelScope.launch {
            if (confirm is ConfirmFlow.AwaitingConfirmation) {
                runAction(confirm.item, confirm.action, confirm.intentId, confirmed = true)
                return@launch
            }

            val item = state.top ?: return@launch
            val action = item.actions.firstOrNull() ?: return@launch
            runAction(item, action, UUID.randomUUID().toString(), confirmed = false)
        }
    }

    fun onDismissConfirmation() {
        _uiState.update {
            if (it.confirm is ConfirmFlow.AwaitingConfirmation) it.copy(confirm = ConfirmFlow.Idle) else it
        }
    }

    /**
     * Voice-intent stub: wired to a button today, meant for the "status"
     * ASR phrase once the emulator voice path is exercised on a host that
     * can run it.
     */
    fun onStatusQuery() {
        viewModelScope.launch {
            val outcome = client.statusQuery(UUID.randomUUID().toString())
            val line = when (outcome) {
                is StatusQueryOutcome.Report -> summarizeStatusReport()
                is StatusQueryOutcome.Unavailable -> outcome.message
            }
            _uiState.update { it.copy(statusLine = line) }
            delay(STATUS_LINE_MS)
            _uiState.update { if (it.statusLine == line) it.copy(statusLine = null) else it }
        }
    }

    private fun summarizeStatusReport(): String {
        // The report body shape is orchestrator-specific; the glanceable
        // answer the surface actually needs is already in the snapshot.
        val count = _uiState.value.needsMeCount
        return if (count == 0) "All clear" else "$count item(s) need you"
    }

    private suspend fun runAction(
        item: AttentionItem,
        action: HubAction,
        intentId: String,
        confirmed: Boolean,
    ) {
        _uiState.update { it.copy(confirm = ConfirmFlow.InFlight(action.label)) }

        val outcome = client.postAction(item.id, action.id, intentId, confirmed)
        val next = when (outcome) {
            is ActionOutcome.Success -> ConfirmFlow.Notice("${action.label}: sent")
            is ActionOutcome.NeedsConfirmation ->
                ConfirmFlow.AwaitingConfirmation(item, action, intentId)

            is ActionOutcome.Failure ->
                if (confirmed) {
                    ConfirmFlow.AwaitingConfirmation(
                        item = item,
                        action = action,
                        intentId = intentId,
                        failureNote = "${action.label} failed (${outcome.code}) - retry?",
                    )
                } else {
                    ConfirmFlow.Notice("${action.label} failed (${outcome.code})")
                }
        }
        _uiState.update { it.copy(confirm = next) }

        if (next is ConfirmFlow.Notice) {
            delay(NOTICE_MS)
            _uiState.update { if (it.confirm == next) it.copy(confirm = ConfirmFlow.Idle) else it }
        }
    }

    private companion object {
        const val NOTICE_MS = 2_500L
        const val STATUS_LINE_MS = 4_000L
    }
}
