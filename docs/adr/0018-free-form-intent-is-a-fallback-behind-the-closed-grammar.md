# Free-form intent is a fallback behind the closed grammar, not a replacement

Phase 1 mapped speech to Actions through a **closed command grammar** (ADR-0011); anything outside it is a no-match that never acts. Phase 3 adds **free-form intent** — a local LLM (Ollama) that turns a natural-language utterance into a structured `Intent` — but wires it as a **fallback stage**, not a new path:

- **The closed grammar runs first on every utterance** — deterministic, zero-LLM, instant. It still handles the common verbs and navigation exactly as in Phase 1.
- **Only a `no_match` whose reason is `unknown_command` falls through to the LLM.** The other no-match reasons (`low_confidence`, `no_referent`, `action_unavailable`, `ambiguous`) stay **hard rejections** — a mis-heard transcript or a missing/ambiguous referent must not be "rescued" by guessing.
- **The LLM emits a structured `Intent`** (ADR-0019/0020) that re-enters the **same** session/confirm/no-match funnel (`reduce()` → effect) the closed grammar feeds. Free-form is a smarter parser, never a new execution surface.
- **The pipeline (closed-grammar → fallback) is extracted** so it serves both the voice path (`audio → STT → pipeline`) and a new typed **Intent bar** on the flat cockpit (`text → pipeline`). Free-form intent is therefore usable even when voice is disabled (the default).
- **Opt-in:** `intent.freeform.enabled` defaults `false`, the same posture as `voice.enabled` and `previews.enabled`.

We rejected **LLM-primary routing** (every utterance through the model: slower, non-deterministic on the common path, GPU always in the loop) and an **explicit "free-form mode" toggle** (extra interaction surface; the implicit fall-through is invisible until it's needed). Keeping the closed grammar first preserves the deterministic, offline-capable core and confines the LLM to the long tail.
