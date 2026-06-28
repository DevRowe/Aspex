# Card 27 — Voice gateway orchestrator

## Goal
Wire the pure pieces into the **voice gateway** (ADR-0010): take an Utterance + `VoiceContext`, run STT → parser → session machine, perform the resulting effect (dispatch an Action, resolve navigation, arm a confirm, manage dictation), build the **read-back** (text + Piper audio), and return a `VoiceResult`. This is the IO orchestration layer; all decision logic lives in the pure cards it calls.

## Depends on
- Card 24 (STT/TTS clients + mock), Card 25 (parser), Card 26 (session state machine), Card 23 (types).
- Card 08 (`dispatchAction`) and Card 05 (`rank`) from Phase 0 — injected, not imported directly.

## Files to create
```
apps/hub/src/voice/gateway.ts
apps/hub/test/gateway.test.ts
```

## Interfaces / stubs

```ts
import type { VoiceContext, VoiceResult, Action, ItemId } from "@aspex/schema";
import type { SttClient, TtsClient } from "./sttClient";        // card 24
import { parse } from "./grammar";                              // card 25
import { reduce } from "./session";                             // card 26 (pure: (session, intent, meta) => { next, effect })

export interface GatewayDeps {
  stt: SttClient;
  tts: TtsClient | null;                                        // null => text-only read-back
  dispatchAction: (itemId: string, actionId: string, payload?: unknown) => Promise<import("@aspex/schema").ActionResult>;
  getSelectedActions: (id: ItemId) => Action[];                 // from the world-model snapshot
  resolveProject: (name: string) => ItemId | "ambiguous" | null;
  snapshotNeedsMe: () => ItemId[];                              // current ranked needs-me ids (for "what needs me" read-back)
  readItem: (id: ItemId) => string;                            // deterministic summary line for "read it"
  confidenceThreshold: number;
  confirmTtlMs: number;
}

export class VoiceGateway {
  constructor(private deps: GatewayDeps) {}
  // ONE session per gateway instance (single local user — ADR-0005 single-process).
  async handle(audio: Uint8Array, mime: string, context: VoiceContext): Promise<VoiceResult>;
}
```

### `handle` flow (orchestration only — no business rules)
1. `transcript = await stt.transcribe(audio, mime)`. On STT failure/timeout → `VoiceResult { ok:false, readback: "I couldn't hear that.", session }` (no dispatch).
2. Expire `pendingConfirm` if older than `confirmTtlMs` (delegate to `reduce`/session helper).
3. `intent = parse({ transcript, context, session, selectedActions: getSelectedActions(context.selectedId), resolveProject, confidenceThreshold })`.
4. `{ next, effect } = reduce(session, intent, { actionMeta })` — the **pure** state machine decides arm-vs-fire, enter/exit dictation, what to do. Save `next` as the gateway's session.
5. Perform `effect`:
   - `effect.dispatch` → `await dispatchAction(itemId, actionId, payload)`; read-back from `ActionResult.message`.
   - `effect.navigate` / `effect.read` / `effect.open` → build read-back from `snapshotNeedsMe`/`readItem`; set `directive`.
   - `effect.armed` → read-back "Say 'confirm ‹verb›' to ‹verb› ‹item›." (NO dispatch.)
   - `effect.dictationPrompt` → read-back "Dictate your ‹comment/changes›, then say 'post it'."
   - `effect.dictationReadback` → read-back the captured body + "Say 'post it' to send, or 'cancel'." (NO dispatch yet.)
   - `effect.noMatch` → read-back the rejection message for the `NoMatchReason` (no dispatch).
6. `audioUrl = tts ? await tts.speak(readback) : undefined` (TTS failure → just omit audio; never fail the whole result).
7. Return `{ ok, readback, audioUrl, directive, session: next }`.

## Steps
1. Implement `VoiceGateway` with the flow above; keep each branch a few lines — push logic into `reduce`.
2. Map each `NoMatchReason` to a friendly read-back string (one table).
3. Ensure **no path dispatches an action without going through `reduce`'s effect** (the safe-grammar funnel).
4. Write `gateway.test.ts` using the **mock STT/TTS** and a fake `dispatchAction` spy.

## Acceptance check
```bash
bun test apps/hub/test/gateway.test.ts     # green
```
Tests must prove the full loop (mock STT returns scripted transcripts):
- "merge" on a merge-able selected Item → **does NOT call `dispatchAction`**; read-back asks for "confirm merge"; `session.pendingConfirm` set.
- then "confirm merge" → calls `dispatchAction(id, "merge", { confirmed: true })` once; read-back from the result.
- "comment" → read-back prompts dictation, `session.dictating` set; next utterance "looks good to me" → read-back echoes it + asks to post, **no dispatch**; then "post it" → dispatches `comment` with the body.
- a `low_confidence` transcript → no dispatch, rejection read-back.
- STT throws → `ok:false`, friendly read-back, no dispatch.
- "what needs me" → directive `show_needs_me`, read-back lists the (mocked) needs-me; no dispatch.

## Out of scope / do NOT do
- No HTTP here — that's card 28. The gateway is called by the endpoint.
- Do not put grammar/arming/dictation decisions in the gateway — they live in `parse` (25) and `reduce` (26). The gateway only performs effects.
- Do not implement multi-user sessions (single local user — ADR-0005). One session per gateway instance.
- Do not let a TTS failure or an unknown command throw — both produce a valid `VoiceResult`.
- Do not optimistically touch the world-model; dispatched actions flow back as Signals like any other (Phase 0).
