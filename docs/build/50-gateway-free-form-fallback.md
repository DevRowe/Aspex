# Card 50 — Free-form fallback in the voice gateway

## Goal
Extend the `VoiceGateway` (card 27) so that when the closed grammar returns `no_match` with reason **`unknown_command`** — and only then — it calls the [[Intent service]], **tags** the resulting Intent as free-form provenance, **elevates** the confirm requirement for free-form-originated actions, and re-enters the **same** `reduce()` → `performEffect()` funnel with an **honest read-back**. This is where ADR-0018's routing and ADR-0020's bounds become code.

## Depends on
- Card 27 (`VoiceGateway`, `GatewayDeps`, `handle`), Card 48 (`IntentService`), Card 47 (`IntentRequest`, `IntentCandidate`), Card 49 (the schema the service uses).

## Files to edit
```
apps/hub/src/voice/gateway.ts        # add the fallback branch + provenance + elevate-confirm
apps/hub/test/gateway-freeform.test.ts   # new tests
```

## Wire-up (`GatewayDeps` additions — all optional, so a Phase-1 gateway is unchanged)
```ts
export interface GatewayDeps {
  /* …existing… */
  intentService?: IntentService;                 // present only when freeform is configured (card 53)
  snapshotCandidates?: () => IntentCandidate[];   // needs-me items as { itemId, summary, actions } (the enum source)
  elevateFreeformConfirm?: boolean;               // default true (ADR-0020)
}
```

## Logic (inside `handle`, after `parse()` yields `intent`)
```ts
let provenance: "grammar" | "freeform" = "grammar";

if (
  intent.kind === "no_match" && intent.reason === "unknown_command" &&
  this.deps.intentService && this.deps.snapshotCandidates
) {
  const req: IntentRequest = { text: transcript.text, context, candidates: this.deps.snapshotCandidates() };
  const { intent: llmIntent } = await this.deps.intentService.resolve(req);   // single call, single-shot
  // defensive: the service already guarantees first-stage + in-enum (card 48); trust but keep the type narrow.
  intent = llmIntent;
  provenance = "freeform";
}
```
Then reduce **as today**, but wrap the confirm predicate so a free-form-originated action **arms instead of firing**:
```ts
requiresConfirmation: (itemId, actionId) =>
  baseRequiresConfirmation(itemId, actionId) ||
  (provenance === "freeform" && (this.deps.elevateFreeformConfirm ?? true)),
```
Read-back honesty: when `provenance === "freeform"` and the effect is `armed`/`dispatch`/`read`/`open`/`navigate`, prefix the interpretation — e.g. `"I read that as: approve atlas#42 — say 'confirm approve' to proceed."` (Never act silently on an LLM interpretation.)

## Steps
1. Add the three optional deps; default `elevateFreeformConfirm` to `true`.
2. Insert the fallback branch — **only** for `unknown_command` (NOT `low_confidence`/`no_referent`/`action_unavailable`/`ambiguous`, ADR-0018).
3. Wrap the `requiresConfirmation` predicate to elevate free-form-originated actions (ADR-0020).
4. Thread `provenance` into the read-back so interpretations are stated.
5. Tests (use `MockIntentService` + a spy).

## Acceptance check
```bash
bun test apps/hub/test/gateway-freeform.test.ts     # green
```
Tests must prove:
- A **closed-grammar match** ("approve") dispatches/arms via the grammar and the intent service spy is **not called**.
- An unknown utterance ("please approve the atlas review") with the mock service scripted to `{action, itemId, actionId:approve}` → the action is **armed** (elevated confirm), the read-back **names the interpretation**; a following "confirm approve" dispatches **once**.
- A `low_confidence` or `no_referent` no-match does **not** call the intent service (only `unknown_command` does).
- With **no** `intentService` configured, `unknown_command` stays a plain no_match read-back (Phase-1 behaviour intact).
- With `elevateFreeformConfirm:true`, a normally-`safe` free-form action arms rather than dispatching.

## Out of scope / do NOT do
- No schema building (49), no HTTP transport (48), no `/intent` text endpoint (51), no config (53).
- Do **not** call the intent service for any reason other than `unknown_command`.
- Do **not** let a free-form Intent reach `confirm`/`dictation_body`/`post` — card 48 already coerces those to no_match; do not add a path that bypasses that.
- Do not loop / retry the service (single-shot, ADR-0020).
