# Later phases — outline (not yet chunked)

These phases are **outlined, not buildable yet**. Most are Labs/experimental with unresolved decisions (spatial perf, hardware availability, billing). Chunk each into task cards only when its decisions firm up — run another grill-with-docs pass first. The Phase 0 core (cards 01–21) must not depend on any of this.

---

## Phase 1 — Push-to-talk voice on flat
**Goal:** speak to the cockpit; gaze/selection as pointer, voice as verb, hold-to-talk (no open mic, no wake word).

Locked-in from the plan:
- **STT:** Parakeet (local, GPU on the Ollama box), batch transcription of discrete utterances. Fallback: whisper.cpp / faster-whisper (CPU).
- **TTS:** Piper (local neural) for read-backs. Web Speech Synthesis only as a throwaway first cut.
- **Intent:** fixed command grammar first (free-form is Phase 3). Safe grammar — never let a fuzzy parse merge/deploy/delete.
- **Confirm:** two-step confirm-phrase for `dangerous` actions (the voice version of card 13's typed confirm).

Must-verify early (the plan's flag): **mic capture inside an active `immersive-ar` WebXR session is unreliable on some runtimes — test on the real HoloLens 2 / Android XR target before any spatial work.** Web Speech API is cloud in Chrome — not the foundation.

Open questions to grill before chunking: exact command grammar; how gaze/selection maps to "the selected Item" on flat (no headset yet); push-to-talk trigger on desktop/DeX (key? button?); where Parakeet runs vs the Hub; latency budget.

---

## Phase 2 — Labs: Spatial shell (experimental)
**Goal:** port the flat needs-me panels into a calm WebXR arc.
- Stack: `@react-three/xr` + `@react-three/uikit` + drei + three.js (all MIT). One r3f tree renders flat (`<Canvas>`/DOM) and immersive.
- Interaction: gaze-dwell + push-to-talk. HoloLens 2 now (test rig), Aura later.
- **Benchmark gate:** can you hold ~10–20 live uikit panels at stable framerate on HoloLens 2? If not → texture-snapshot panels, or evaluate Babylon.js (Apache fallback).

### Labs: Preview Deck (parallel, non-blocking)
Container-isolated ephemeral previews. **Security first (the plan's §4):** never execute agent code in the cockpit origin; previews in a separate origin / cross-origin iframe, postMessage-only; container per boot (Docker spike → E2B/microsandbox later); **pixels not code** (neko/WebRTC video texture) for arbitrary apps; only your own trusted preview servers get a real iframe; AR content = static glTF/GLB/USDZ first. The persistent monitoring layer (Phase 0) stays untouched; previews are disposable.

Open questions: which to spike first (spatial panels vs preview); HoloLens 2 sunsetting timeline vs effort; uikit perf reality.

---

## Phase 3 — Delegation depth + adapters + Teach (Labs)
- **Provisions** wired (interface from card 02/08 already pluggable): **cursor** (background agents, mostly visible via GitHub PRs), **opencode** (MIT TUI; MCP/events), **cowork** (integration path TBD — research flagged).
- **codex** adapter fleshed out (CLI/cloud status; PR work already covered by github).
- **Free-form intent:** Ollama + GBNF grammar → structured action (local, free on existing GPU). Still gated by the safe-action confirm rules.
- **Teach Pane (Labs):** a summoned local-Ollama pane — "explain why this agent is blocked", "show the diff as a concept", "what's the safe approval path?". Differentiating; parked as Labs to keep the core small.
- **PTY control for claude-code** (deferred from Phase 0, ADR-0004): re-verify the subscription/billing specifics first (the plan's §8 — the 15 Jun 2026 Agent-SDK-credit split is load-bearing and changeable). Mark experimental; two-step confirm for anything destructive.

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
