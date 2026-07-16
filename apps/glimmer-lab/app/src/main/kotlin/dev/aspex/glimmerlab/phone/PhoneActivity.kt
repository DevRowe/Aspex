package dev.aspex.glimmerlab.phone

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.xr.projected.ProjectedContext
import androidx.xr.projected.experimental.ExperimentalProjectedApi
import dev.aspex.glimmerlab.BuildConfig
import dev.aspex.glimmerlab.ConnectionState
import dev.aspex.glimmerlab.GlanceViewModel
import dev.aspex.glimmerlab.glasses.GlassesActivity

/**
 * Phone-side companion. The projected model keeps all logic on the phone;
 * this activity exists to show connection health and to hand-launch the
 * glasses surface while the emulator voice launcher is not in play.
 */
class PhoneActivity : ComponentActivity() {
    private val viewModel: GlanceViewModel by viewModels()

    @OptIn(ExperimentalProjectedApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val state by viewModel.uiState.collectAsState()
            var launchNote by remember { mutableStateOf("") }

            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text("Aspex Glance", style = MaterialTheme.typography.headlineSmall)
                        Text("Hub: ${BuildConfig.ASPEX_HUB_URL}")
                        Text(
                            when (state.connection) {
                                ConnectionState.CONNECTING -> "Connecting…"
                                ConnectionState.LIVE -> "Live · ${state.needsMeCount} item(s) need you"
                                ConnectionState.LOST ->
                                    "Disconnected: ${state.disconnectReason ?: "unknown"} (retrying)"
                            },
                        )
                        state.top?.let { top ->
                            Text("Top: [${top.severity}] ${top.project} - ${top.summary}")
                        }
                        Button(onClick = { launchNote = launchOnGlasses() }) {
                            Text("Launch on glasses")
                        }
                        if (launchNote.isNotEmpty()) {
                            Text(launchNote)
                        }
                    }
                }
            }
        }
    }

    @OptIn(ExperimentalProjectedApi::class)
    private fun launchOnGlasses(): String = try {
        val options = ProjectedContext.createProjectedActivityOptions(this)
        startActivity(Intent(this, GlassesActivity::class.java), options.toBundle())
        "Launched on glasses."
    } catch (e: Exception) {
        "Glasses launch failed: ${e.message ?: e.javaClass.simpleName}. Is a glasses device paired?"
    }
}
