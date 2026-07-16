package dev.aspex.glimmerlab.glasses

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.xr.glimmer.ActionCard
import androidx.xr.glimmer.Button
import androidx.xr.glimmer.Card
import androidx.xr.glimmer.GlimmerTheme
import androidx.xr.glimmer.Text
import androidx.xr.glimmer.TitleChip
import dev.aspex.glimmerlab.ConfirmFlow
import dev.aspex.glimmerlab.ConnectionState
import dev.aspex.glimmerlab.GlanceUiState
import dev.aspex.glimmerlab.api.AttentionItem
import kotlinx.coroutines.flow.StateFlow

/**
 * The Glimmer design contract governs everything here: glanceable not
 * immersive, reality wins, a 2-3 second read. One card, one action, dark
 * scrim-free surfaces, nothing persistent.
 */
@Composable
fun GlanceScreen(
    uiState: StateFlow<GlanceUiState>,
    onPrimaryAction: () -> Unit,
    onDismissConfirmation: () -> Unit,
    onStatusQuery: () -> Unit,
) {
    val state by uiState.collectAsState()

    GlimmerTheme {
        Box(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            when {
                state.connection == ConnectionState.CONNECTING -> StatusCard("Connecting to Aspex Hub…")

                state.connection == ConnectionState.LOST ->
                    StatusCard("Hub unreachable: ${state.disconnectReason ?: "unknown"}")

                state.confirm is ConfirmFlow.AwaitingConfirmation -> ConfirmCard(
                    confirm = state.confirm as ConfirmFlow.AwaitingConfirmation,
                    onConfirm = onPrimaryAction,
                    onDismiss = onDismissConfirmation,
                )

                state.confirm is ConfirmFlow.InFlight ->
                    StatusCard("${(state.confirm as ConfirmFlow.InFlight).label}…")

                state.confirm is ConfirmFlow.Notice ->
                    StatusCard((state.confirm as ConfirmFlow.Notice).message)

                state.top == null -> AllClearCard(onStatusQuery)

                else -> TopItemCard(
                    item = checkNotNull(state.top),
                    needsMeCount = state.needsMeCount,
                    onPrimaryAction = onPrimaryAction,
                    onStatusQuery = onStatusQuery,
                )
            }

            state.statusLine?.let { line ->
                Box(
                    modifier = Modifier.fillMaxSize().padding(bottom = 8.dp),
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    TitleChip { Text(line) }
                }
            }
        }
    }
}

/** Highest-ranked needs-me item: severity, project, summary, one action. */
@Composable
private fun TopItemCard(
    item: AttentionItem,
    needsMeCount: Int,
    onPrimaryAction: () -> Unit,
    onStatusQuery: () -> Unit,
) {
    val primaryAction = item.actions.firstOrNull()

    ActionCard(
        title = { Text(item.project, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        subtitle = {
            Text(
                text = severityLabel(item) + if (needsMeCount > 1) " · ${needsMeCount - 1} more" else "",
                color = severityColor(item.severity),
                maxLines = 1,
            )
        },
        action = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (primaryAction != null) {
                    Button(onClick = onPrimaryAction) { Text(primaryAction.label) }
                }
                Button(onClick = onStatusQuery) { Text("Status") }
            }
        },
    ) {
        Text(item.summary, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Second leg of the Hub's 409 confirm gate: restate the referent and ask for
 * one more temple tap.
 */
@Composable
private fun ConfirmCard(
    confirm: ConfirmFlow.AwaitingConfirmation,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    ActionCard(
        title = { Text("Confirm: ${confirm.action.label}?") },
        subtitle = { Text(confirm.item.project, maxLines = 1) },
        action = {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onConfirm) { Text("Confirm") }
                Button(onClick = onDismiss) { Text("Cancel") }
            }
        },
    ) {
        Text(confirm.item.summary, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun AllClearCard(onStatusQuery: () -> Unit) {
    ActionCard(
        title = { Text("All clear") },
        action = { Button(onClick = onStatusQuery) { Text("Status") } },
    ) {
        Text("Nothing needs you.")
    }
}

@Composable
private fun StatusCard(message: String) {
    Card {
        Text(message, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

private fun severityLabel(item: AttentionItem): String =
    "${item.severity.uppercase()} · ${item.reason.replace('_', ' ')}"

@Composable
private fun severityColor(severity: String): Color = when (severity) {
    "high" -> GlimmerTheme.colors.negative
    "medium" -> GlimmerTheme.colors.primary
    else -> GlimmerTheme.colors.secondary
}
