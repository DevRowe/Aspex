# Later phases — outline (not yet chunked)

These phases are **outlined, not buildable yet**. Most are Labs/experimental with unresolved decisions (spatial perf, hardware availability, billing). Chunk each into task cards only when its decisions firm up — run another grill-with-docs pass first. The Phase 0 core (cards 01–21) must not depend on any of this.

---

## Phase 1 — Push-to-talk voice on flat — ✅ CHUNKED (cards 22–34)

**No longer an outline.** Phase 1 has been grilled and chunked into task cards: see `22-phase-1-index.md` (index + canonical voice contract + command grammar) and cards `23`–`34`. The decisions are recorded in ADR-0009…0013 and the glossary in `../../CONTEXT.md` (the *Voice (Phase 1)* section).

What got resolved from the old open questions: Hub-brokered voice gateway (ADR-0010); browser `getUserMedia` capture; PTT = on-screen hold-button + hold-`Space`; referents via client voice-context; closed fixed grammar mapped to existing Actions with a confidence gate (ADR-0011); **bounded free-text dictation IS in Phase 1** via two-step read-back-before-post + a new `request_changes` github action (ADR-0012); generic HTTP STT/TTS contract with ordered fallback + reference Python server + mock, Piper read-back, Web Speech dev-only (ADR-0013).

**Scope note (ADR-0009): Phase 1 is flat voice only.** The WebXR mic-capture verification is *not* a Phase 1 card — it is the **Phase 2 entry gate** below.

---

## Phase 2 entry gate — WebXR mic-capture verification (hardware-gated)
**Must pass before any Phase 2 spatial work begins (ADR-0009).** The plan's flag: **mic capture inside an active `immersive-ar` WebXR session is unreliable on some runtimes — verify it on the real HoloLens 2 / Android XR target.** Web Speech API is cloud in Chrome — not the foundation; this gate verifies the local `getUserMedia` path (the same one Phase 1's flat capture uses) survives inside an immersive session.

This is a small de-risking spike, **blocked on hardware** (the Aura grey-import is pending; HoloLens 2 is a test rig). It runs the moment a target is in hand; it does **not** block any Phase 1 card. Outcome decides whether Phase 2 push-to-talk reuses the flat capture path as-is or needs a workaround (e.g. capture outside the session, or a native bridge).

---

## Phase 2 — Labs: Spatial shell (experimental)
**Goal:** port the flat needs-me panels into a calm WebXR arc. **Gated by the Phase 2 entry gate above.**
- Stack: `@react-three/xr` + `@react-three/uikit` + drei + three.js (all MIT). One r3f tree renders flat (`<Canvas>`/DOM) and immersive.
- Interaction: gaze-dwell + push-to-talk (the Phase 1 voice gateway is reused; gaze-dwell replaces the flat PTT trigger). HoloLens 2 now (test rig), Aura later.
- **Benchmark gate:** can you hold ~10–20 live uikit panels at stable framerate on HoloLens 2? If not → texture-snapshot panels, or evaluate Babylon.js (Apache fallback).

### Labs: Preview Deck (parallel, non-blocking) — ✅ CHUNKED (cards 35–45)
Container-isolated ephemeral previews. **Security first (the plan's §4):** never execute agent code in the cockpit origin; previews in a separate origin / cross-origin iframe, postMessage-only; container per boot (Docker spike → E2B/microsandbox later); **pixels not code** (neko/WebRTC video texture) for arbitrary apps; only your own trusted preview servers get a real iframe; AR content = static glTF/GLB/USDZ first. The persistent monitoring layer (Phase 0) stays untouched; previews are disposable.

**No longer an outline.** The Preview Deck — the *buildable-now*, hardware-independent half of Phase 2 — has been grilled and chunked: see `35-phase-2-preview-deck-index.md` (index + canonical contract + guardrails) and cards `36`–`45`. Decisions are recorded in ADR-0014…0017 and the *Preview Deck (Phase 2)* glossary section in `../../CONTEXT.md`. What got resolved from the open questions: boot declared specs, never build/compute (0014); a Preview is ephemeral, not an Item, world-model untouched (0015); **v1 = trusted cross-origin sandboxed iframe only**, the neko/WebRTC pixels lane deferred, trust taxonomy in the model (0016); Docker via the CLI, opt-in/capability-detected, pluggable engine + mock, bounded/no-orphan lifecycle, broker as a Hub subsystem (0017). **Scope note:** v1 is **flat only, one preview kind (a running web app)**; glTF/USDZ AR-content previews and the spatial rendering of preview tiles defer to the Spatial Shell track below.

The **Spatial shell** above remains outlined-only and **gated by the Phase 2 entry gate** (ADR-0009). Open questions still parked there: HoloLens 2 sunsetting timeline vs effort; uikit perf reality; whether preview tiles become spatial panels as-is.

---

## Phase 3 — Delegation depth + adapters + Teach (Labs)

**The buildable-now delegation core — ✅ CHUNKED (cards 46–58).** Grilled via grill-with-docs (6 decisions) and chunked: see `46-phase-3-index.md` (index + canonical contracts + the free-form safety model) and cards `47`–`58`. Decisions are recorded in ADR-0018…0022 and the *Delegation & free-form intent (Phase 3)* glossary section in `../../CONTEXT.md`. Two tracks shipped:

- **Track A — Free-form intent** (cards 47–53): Ollama + a per-request **JSON-Schema (GBNF-enforced)** constraint turning natural language into **one** structured action, as a **fallback** behind the Phase 1 closed grammar (only `unknown_command` falls through — ADR-0018), reached as a pluggable, mock-first **[[Intent service]]** (ADR-0019), **bounded by construction** — enum output, single-shot, never `confirm`/`dictation_body`, elevate-confirm (ADR-0020). Serves **voice + a typed [[Intent bar]]**, usable with voice off.
- **Track B — Agent adapters** (cards 54–57): **codex** (`notify`→`hook-relay`), **opencode** (`opencode serve` `/event` SSE), **cursor** (opt-in signed inbound webhook — a bounded exception to no-public-ingress, ADR-0022). All **observe + deep-link only**, owning agent-local attention; PR-lifecycle stays the github adapter's (ADR-0021).

**What got resolved from the old open questions:** free-form is a fallback (not LLM-primary), constrained via Ollama's JSON-Schema path (not raw GBNF), bounded by construction (not by trusting the model); codex/opencode have clean local-first ingestion; cursor needed public ingress so it became an opt-in webhook lane (user overrode the "outline it" recommendation); two-way agent control was deferred to a future ADR. The remaining outlines below stay outlines.

### Still outlined (not chunked) — firm up each with another grill-with-docs pass first

- **Teach Pane (Labs):** a summoned local-Ollama pane — "explain why this agent is blocked", "show the diff as a concept", "what's the safe approval path?". **Reuses the [[Intent service]] seam** (cards 48/53), so it is a thin follow-on; parked as Labs to keep the core small. Open: read-only explainer vs interactive; how much Item/diff context it may see (same untrusted-text discipline as ADR-0020).
- **PTY control for claude-code** (deferred from Phase 0, ADR-0004; **two-way agent control deferred again in ADR-0021**): re-verify the subscription/billing specifics **first** (the plan's §8 — the 15 Jun 2026 Agent-SDK-credit split is load-bearing and changeable — **read the `claude-api` skill, do not answer from memory**). Mark experimental; its own dangerous-action design + two-step confirm. The natural home for the deferred two-way control surface (opencode's local API could be the first safe instance).
- **cowork** Provision: integration path still **research-TBD** (no documented event/task/notification surface found) — the one outstanding [[Provision]]. Chunk once a concrete ingestion path exists.
- **Public-webhook / Tailscale Funnel subsystem:** the cursor lane (ADR-0022) is user-exposed only; a first-class inbound-ingress subsystem (signed, Funnel-managed) would let cursor and other cloud webhooks work without manual tunnelling. Out of Phase 3 scope.

---

## Phase 4 — Aura / Android XR + (optional) OSS release
- Apply to Google's **Android XR Developer Catalyst Program** (free target hardware — you're building Android XR tooling).
- Grey-import an **XREAL Aura** to Perth (AU not in the Fall-2026 launch wave).
- Tune for ~70° FoV + hand input.
- Optionally release the flat core under **Apache-2.0** with a demo video.

---

## Standing action items (from the plan, not phase-gated)
1. **Clear the name** *Aspex/Auspex* — grab the GitHub org + a `.dev`/`.app` domain together (the real availability test, not npm). *Aspex* collides with an eyewear brand + an old semiconductor firm; *Auspex* with a defunct storage company.
2. Apply to the **Android XR Developer Catalyst Program**.
3. Plan the **Aura grey-import to Perth**.
4. **Re-verify the Claude Code subscription/billing** specifics before relying on the PTY path (§8).
5. Get an **R&D tax adviser** to scope eligibility before banking on the 43.5% (most of Phase 0 is routine dev the R&DTI excludes; only narrow bits — cross-surface live sync, the sandboxed in-session AR guest-contract — are arguably core R&D).
6. Keep the **dependency licence registry** current (`docs/licenses.md`); no AGPL/GPL in the closed core.
