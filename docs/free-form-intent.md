# Free-Form Intent

Free-form intent is the opt-in Phase 3 path for natural-language commands that
the closed Phase 1 grammar cannot parse. It is not an orchestrator and it is not
an Adapter. It is a constrained Intent service that maps one typed or spoken
line to one first-stage `Intent`.

## Pipeline

The closed grammar always runs first. The Intent service is called only when the
grammar returns `no_match` with reason `unknown_command`.

Other no-match reasons are hard stops:

- `low_confidence`
- `no_referent`
- `action_unavailable`
- `ambiguous`

Voice and typed text share this pipeline. The web Intent bar posts typed text to
`POST /intent`; push-to-talk posts audio to `POST /voice/utterance`; both enter
the same grammar-first gateway and receive the same `VoiceResult` shape.

## Constraint Mechanism

The shipped implementation calls local Ollama over HTTP:

```txt
POST <endpoint>/api/chat
```

The request uses Ollama's structured-output path by sending a per-request JSON
Schema in the `format` field. Ollama turns that schema into constrained decoding
internally. The schema is built from the current Voice context:

- `itemId` is an enum of live ids from `selectedId` plus `needsMeIds`.
- `actionId` is an enum of the selected Item's live actions.
- navigation, read, open, action, dictate, and abstain branches are explicit.
- abstain returns `no_match` with reason `unknown_command`.

The model sees Item summaries and action ids as untrusted text. It cannot
invent ids or actions because the output shape is the constrained `Intent`
union, not executable text.

## Bounded by Construction

Free-form output is first-stage only. The schema permits:

- `nav`
- `read`
- `open`
- `action`
- `dictate`
- `no_match`

It does not permit `confirm`, `dictation_body`, `post`, or `cancel`. A free-form
command can arm an action or enter Dictation mode, but the deterministic second
step remains separate: the user must still type or say `confirm <verb>` or
`post it` after the Hub reads back the pending state.

Each utterance or typed line is single-shot. The Intent service returns one
Intent or abstains. Compound, conditional, scheduled, or multi-step instructions
must resolve to `unknown_command`.

Free-form-originated actions elevate confirmation. With the default
`elevateConfirm: true`, even a normally safe action is read back and armed
instead of dispatched immediately. Dangerous actions still require confirmation
through the normal confirmation path.

Readback is honest about provenance. The Hub tells the user when it interpreted
a free-form command, for example: `I read that as: approve ...`.

## Configuration

Free-form intent is off by default. For a no-GPU smoke test, use mock mode:

```sh
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun apps/hub/src/cli.ts intent check
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 bun apps/hub/src/cli.ts hub --mock
```

When using an installed CLI, the same check is:

```sh
ASPEX_INTENT_ENABLED=1 ASPEX_INTENT_MOCK=1 aspex intent check
```

For a real local Ollama service:

```sh
ASPEX_INTENT_ENABLED=1 \
ASPEX_INTENT_ENDPOINTS=http://127.0.0.1:11434 \
ASPEX_INTENT_MODEL=llama3.1 \
bun apps/hub/src/cli.ts intent check
```

`ASPEX_INTENT_ENDPOINTS` accepts comma-separated Ollama base URLs. The Hub adds
`/api/chat`. The selected model and its weights are host-installed and should be
reviewed by the user for license and suitability.

Equivalent config fields live under `intent`:

```json
{
  "intent": {
    "enabled": true,
    "endpoints": ["http://127.0.0.1:11434"],
    "model": "llama3.1",
    "timeoutMs": 8000,
    "elevateConfirm": true,
    "mock": false
  }
}
```

## HTTP Contract

`POST /intent` accepts:

```ts
interface IntentHttpBody {
  text: string;
  context: VoiceContext;
}
```

It returns `VoiceResult`, the same result envelope used by
`POST /voice/utterance`. When intent is disabled or the gateway is not
configured, the route returns `503`.

## References

- [ADR-0018](adr/0018-free-form-intent-is-a-fallback-behind-the-closed-grammar.md)
- [ADR-0019](adr/0019-the-local-llm-is-a-constrained-intent-service-not-an-adapter.md)
- [ADR-0020](adr/0020-free-form-intent-is-bounded-by-construction-not-by-trusting-the-model.md)
- [Voice grammar](voice-grammar.md)
- [Event schema](event-schema.md)
