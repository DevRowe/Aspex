package dev.aspex.glimmerlab.glasses

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import dev.aspex.glimmerlab.GlanceViewModel

/**
 * The glance surface itself. Declared with
 * `android.intent.category.XR_PROJECTED_LAUNCHER`, so the system (or Gemini
 * voice: "open Aspex Glance") starts it on the glasses display; Jetpack
 * Projected runs the code here on the phone and projects the rendered UI.
 */
class GlassesActivity : ComponentActivity() {
    private val viewModel: GlanceViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GlanceScreen(
                uiState = viewModel.uiState,
                onPrimaryAction = viewModel::onPrimaryAction,
                onDismissConfirmation = viewModel::onDismissConfirmation,
                onStatusQuery = viewModel::onStatusQuery,
            )
        }
    }
}
