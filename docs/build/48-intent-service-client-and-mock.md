# Card 48 — Intent service client + mock (the intent-service contract)

## Goal
The Hub-side client that speaks the generic intent-service contract (ADR-0019): `resolve(req)` calls **Ollama `/api/chat`** with `format` set to the **constrained JSON Schema** (built in card 49), over an **ordered list of endpoints** with fallback + timeout, parses the schema-constrained JSON into an `Intent`, and returns an `IntentResult`. Plus a **mock** that returns canned `Intent`s so the whole free-form loop is testable with **no GPU and no Ollama**. **It never throws into the gateway** — any failure resolves to a `no_match`.

## Depends on
- Card 47 (`IntentRequest`, `IntentResult`), Card 49 (`buildIntentSchema`), Card 23 (`Intent`). Config is injected here; real wiring is card 53.

## Files to create
```
apps/hub/src/voice/intentService.ts      # IntentService + OllamaIntentService + MockIntentService
apps/hub/test/intentService.test.ts
```

## The contract (Ollama)
```
POST {endpoint}/api/chat
  body { "model": <model>, "stream": false,
         "messages": [{ "role":"user", "content": <prompt> }],
         "format": <JSON Schema from card 49> }
  200 -> { "message": { "content": "<json matching the schema>" }, ... }
```
The **schema** is the guarantee (constrained decoding); the **prompt** is only context.

## Interfaces / stubs
```ts
import type { Intent, IntentRequest, IntentResult } from "@aspex/schema";
import { buildIntentSchema } from "./intentSchema";

export interface IntentService {
  // Returns a constrained Intent for an unmatched utterance, or a no_match. NEVER throws.
  resolve(req: IntentRequest): Promise<IntentResult>;
}

export interface HttpIntentConfig { endpoints: string[]; model: string; timeoutMs: number; } // endpoints IN ORDER

export class OllamaIntentService implements IntentService {
  constructor(private cfg: HttpIntentConfig) {}
  async resolve(req) {
    // 1. schema = buildIntentSchema({ needsMeIds, selectedId, selectedActions })  (from req.context + candidates)
    // 2. prompt = compact instructions + the candidate list (id, summary, actions) + req.text
    // 3. for each endpoint: POST /api/chat (AbortController timeout); on 2xx parse message.content as JSON;
    //    DEFENSIVELY re-check the parsed Intent is first-stage AND its itemId/actionId are in the request enum;
    //    -> { intent, source:"freeform" }. On any failure/parse-miss -> try next.
    // 4. if all endpoints fail -> { intent: noMatch(req.text), source:"freeform" }  (NEVER throw)
  }
}

export class MockIntentService implements IntentService {
  constructor(private script: Intent[] = []) {}    // shift() per call; default no_match(unknown_command)
}

function noMatch(text: string): Intent { return { kind: "no_match", heard: text, reason: "unknown_command" }; }
```

## Steps
1. Define `IntentService`, `HttpIntentConfig`, `noMatch`.
2. `OllamaIntentService.resolve`: build schema (card 49) + prompt; ordered try-loop with `AbortController(timeoutMs)`; parse `message.content`.
3. **Defensive re-validation** (belt-and-braces over constrained decoding): reject any parsed Intent whose `kind` is `confirm`/`dictation_body`/`post`, or whose `itemId`/`actionId`/`target` is **not** in the request's candidate/action set → treat as a miss → `noMatch`. (Guardrail 20/21: the gateway must never receive an out-of-space or second-stage intent.)
4. On total failure → `noMatch` (never throw — the gateway already renders a no_match read-back).
5. `MockIntentService`: shift a scripted queue; default `noMatch`.
6. Tests with a stubbed `fetch`.

## Acceptance check
```bash
bun test apps/hub/test/intentService.test.ts     # green
```
Tests must prove:
- A stub returning a valid `action` JSON (itemId+actionId in-enum) → `IntentResult` carrying that Intent, `source:"freeform"`.
- First endpoint 500s, second returns valid JSON → resolves from the **second** (ordered fallback).
- All endpoints fail/time out → resolves a `no_match` (**does not throw**).
- A stub returning an `itemId` **not** in the request candidates → coerced to `no_match` (defensive re-validation).
- A stub returning a `confirm`/`post` intent → coerced to `no_match` (first-stage-only).
- `MockIntentService([{kind:"action",...}])` returns that then the default `no_match`.

## Out of scope / do NOT do
- **No schema-building logic** here (card 49) — import `buildIntentSchema`.
- **No gateway wiring / no elevate-confirm** here (card 50) — this is transport + parse + defensive validation only.
- No config reading (card 53) — config is injected.
- Do **not** throw on failure; the gateway depends on `resolve` always resolving.
- No streaming (`stream:false`); one request per utterance (single-shot, ADR-0020).
