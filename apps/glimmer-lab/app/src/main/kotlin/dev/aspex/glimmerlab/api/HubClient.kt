package dev.aspex.glimmerlab.api

import android.util.Log
import java.io.IOException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
        // SSE stream: the Hub comments `: ping` every 15s (apps/hub/src/http
        // /sse.ts), so a read timeout well above that turns a silently dead
        // connection into onFailure and lets the caller reconnect.
        .readTimeout(45, TimeUnit.SECONDS)
        .build()

    // Unary calls need real timeouts so a stalled Hub cannot pin the UI on
    // InFlight forever; shares the SSE client's connection pool.
    private val unaryClient = httpClient.newBuilder()
        .readTimeout(15, TimeUnit.SECONDS)
        .callTimeout(20, TimeUnit.SECONDS)
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
                    .onFailure { Log.w(TAG, "dropped undecodable state frame", it) }
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
        val httpRequest = request(actionPath(itemId, actionId))
            .post(body.toString().toRequestBody(jsonMediaType))
            .build()

        return runCatching { unaryClient.newCall(httpRequest).await() }.fold(
            onSuccess = { (code, text) ->
                when {
                    // The Hub answers 200 with `{ok:false, message}` for
                    // adapter-level failures, and the intent ledger records
                    // only ok:true entries; mirror the web client's
                    // `body.ok !== false` check so those surface as failures.
                    code == 200 -> when (val failure = adapterFailureMessage(text)) {
                        null -> ActionOutcome.Success(text)
                        else -> ActionOutcome.Failure(code, failure)
                    }
                    // The confirmation gate is only recognizable by status
                    // code + prose today; see the PR notes on Decision 1.
                    code == 409 -> ActionOutcome.NeedsConfirmation(text)
                    else -> ActionOutcome.Failure(code, text)
                }
            },
            onFailure = {
                if (it is CancellationException) throw it
                ActionOutcome.Failure(0, it.message ?: "request failed")
            },
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

        return runCatching { unaryClient.newCall(httpRequest).await() }.fold(
            onSuccess = { (code, text) ->
                if (code == 200) StatusQueryOutcome.Report(text)
                // 404 covers both "no orchestrator configured" (route absent)
                // and an unknown scope; either way there is nothing to read.
                else StatusQueryOutcome.Unavailable("status query unavailable (http $code)")
            },
            onFailure = {
                if (it is CancellationException) throw it
                StatusQueryOutcome.Unavailable(it.message ?: "request failed")
            },
        )
    }

    private companion object {
        const val TAG = "HubClient"
    }
}

/**
 * Extracts the failure message from a 200 response whose body carries the
 * Hub's adapter-level `{ok:false, message}` shape; returns null for ok
 * bodies and for anything unparseable, matching the web client's
 * `body.ok !== false` semantics (apps/web `hubClient.ts`).
 */
internal fun adapterFailureMessage(body: String): String? =
    runCatching {
        val obj = Json.parseToJsonElement(body).jsonObject
        if (obj["ok"]?.jsonPrimitive?.booleanOrNull == false) {
            obj["message"]?.jsonPrimitive?.contentOrNull ?: "action failed"
        } else {
            null
        }
    }.getOrNull()

/**
 * Builds the `/actions/:itemId/:actionId` path with each id percent-encoded
 * as its own segment, mirroring the other clients' `encodeURIComponent`
 * (apps/web `hubClient.ts`, apps/hl2-lab `direction.ts`): GitHub item ids
 * contain `/` (owner/repo), which would otherwise split into an extra path
 * segment and 404 on the Hub's route.
 */
internal fun actionPath(itemId: String, actionId: String): String =
    "/actions/${encodePathSegment(itemId)}/${encodePathSegment(actionId)}"

private fun encodePathSegment(value: String): String =
    URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20")

private suspend fun Call.await(): Pair<Int, String> =
    suspendCancellableCoroutine { continuation ->
        enqueue(object : Callback {
            override fun onResponse(call: Call, response: Response) {
                runCatching { response.use { it.code to it.body.string() } }.fold(
                    onSuccess = { continuation.resume(it) },
                    onFailure = { continuation.resumeWithException(it) },
                )
            }

            override fun onFailure(call: Call, e: IOException) {
                continuation.resumeWithException(e)
            }
        })
        continuation.invokeOnCancellation { cancel() }
    }
