package dev.aspex.glimmerlab.api

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/**
 * Thin client for the Hub's authenticated HTTP/SSE API (ADR-0023 bearer
 * token). Every request carries `Authorization: Bearer <token>`; the SSE
 * stream uses the same header via OkHttp's EventSource, so the deprecated
 * `?token=` query fallback is never needed here.
 */
class HubClient(
    private val baseUrl: String,
    private val token: String,
) {
    private val json = Json { ignoreUnknownKeys = true }

    private val jsonMediaType = "application/json".toMediaType()

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        // SSE stream: no read timeout, the Hub pushes frames indefinitely.
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private fun request(path: String): Request.Builder {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
        if (token.isNotEmpty()) {
            builder.header("Authorization", "Bearer $token")
        }
        return builder
    }

    /**
     * Subscribes to `GET /stream`. The Hub sends a full ranked snapshot as an
     * SSE `state` event immediately on connect and again on every
     * `world:changed`. The flow completes with [HubEvent.Disconnected] and
     * leaves reconnect policy to the caller.
     */
    fun stateStream(): Flow<HubEvent> = callbackFlow {
        val sseRequest = request("/stream")
            .header("Accept", "text/event-stream")
            .build()

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                trySend(HubEvent.Connected)
            }

            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String,
            ) {
                if (type != "state") return
                runCatching { json.decodeFromString<StateSnapshot>(data) }
                    .onSuccess { trySend(HubEvent.Snapshot(it)) }
            }

            override fun onClosed(eventSource: EventSource) {
                trySend(HubEvent.Disconnected("stream closed"))
                close()
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: Response?,
            ) {
                val reason = when {
                    response?.code == 401 -> "unauthorized (check hub token)"
                    response != null -> "http ${response.code}"
                    else -> t?.message ?: "connection failed"
                }
                trySend(HubEvent.Disconnected(reason))
                close()
            }
        }

        val source = EventSources.createFactory(httpClient).newEventSource(sseRequest, listener)
        awaitClose { source.cancel() }
    }

    /**
     * `POST /actions/:itemId/:actionId`. The [intentId] is the idempotency
     * key (design 2.6): the same id is sent on the unconfirmed first call and
     * the confirmed retry, so the Hub's intent ledger replays rather than
     * re-runs a duplicated confirmation.
     */
    suspend fun postAction(
        itemId: String,
        actionId: String,
        intentId: String,
        confirmed: Boolean,
    ): ActionOutcome {
        val body = buildJsonObject {
            put("intentId", intentId)
            if (confirmed) put("confirmed", true)
        }
        val httpRequest = request("/actions/$itemId/$actionId")
            .post(body.toString().toRequestBody(jsonMediaType))
            .build()

        return runCatching { httpClient.newCall(httpRequest).await() }.fold(
            onSuccess = { (code, text) ->
                when {
                    code == 200 -> ActionOutcome.Success(text)
                    // The confirmation gate is only recognizable by status
                    // code + prose today; see the PR notes on Decision 1.
                    code == 409 -> ActionOutcome.NeedsConfirmation(text)
                    else -> ActionOutcome.Failure(code, text)
                }
            },
            onFailure = { ActionOutcome.Failure(0, it.message ?: "request failed") },
        )
    }

    /** `POST /intents` with `verb: "status_query"` scoped to the needs-me inbox. */
    suspend fun statusQuery(intentId: String): StatusQueryOutcome {
        val body = buildJsonObject {
            put("verb", "status_query")
            put("intentId", intentId)
            put("scope", "needs_me")
        }
        val httpRequest = request("/intents")
            .post(body.toString().toRequestBody(jsonMediaType))
            .build()

        return runCatching { httpClient.newCall(httpRequest).await() }.fold(
            onSuccess = { (code, text) ->
                if (code == 200) StatusQueryOutcome.Report(text)
                // 404 covers both "no orchestrator configured" (route absent)
                // and an unknown scope; either way there is nothing to read.
                else StatusQueryOutcome.Unavailable("status query unavailable (http $code)")
            },
            onFailure = { StatusQueryOutcome.Unavailable(it.message ?: "request failed") },
        )
    }
}

private suspend fun Call.await(): Pair<Int, String> =
    suspendCancellableCoroutine { continuation ->
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                val text = response.use { it.body.string() }
                continuation.resume(response.code to text)
            }

            override fun onFailure(call: Call, e: IOException) {
                if (continuation.isActive) {
                    continuation.cancel(e)
                }
            }
        })
        continuation.invokeOnCancellation { cancel() }
    }
