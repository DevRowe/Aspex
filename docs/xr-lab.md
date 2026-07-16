# WebXR lab client

`apps/xr-lab` is an unsupported, lab-only design instrument: a device-neutral WebXR client for testing glance cards, voice, and session-safe direction against the real Hub/orchestrator protocol.
It is not a product client, an extension of the legacy cockpit, or a foundation for the native glance-tier clients.
Its primary target is Android XR (Chrome on Galaxy XR now, XREAL Aura when it ships); it also runs on Meta Quest Browser and on HoloLens 2, which remains the owner's wear-test jig (see the device appendix).
It exists to test the three on-face exit moments against the real Hub/orchestrator protocol on whatever WebXR device is at hand.

## Interaction grammar

Voice plus a discrete select is the primary interaction grammar; it is the only grammar that spans every target tier, including the native glance-tier glasses this lab informs.
The client assumes nothing device-specific about input.
At session start, and on every input-source change, connected `XRInputSource`s are classified in `src/capabilities.ts` into hand, controller, gaze, transient-pointer, or screen capabilities, and the client adapts to what is actually present.
Only classified sources may drive the focus ray (unclassified slots at the identity transform would raycast from the origin and pin focus), and an in-scene hint announces the available select gestures, always listing voice + select first.
No device-only interaction work (for example MRTK-style hand-mesh interactions or HL2 gaze-API deixis) belongs here; anything that does not transfer across WebXR devices is out of scope.

## Local simulator

Install and start the app from the repository root:

```sh
bun install
bun run --cwd apps/xr-lab dev
```

Open `http://localhost:4174` in Chromium.
Pair the exact Hub URL and local bearer token in Settings.
The Hub URL is persisted for convenience, while the bearer token is kept only in tab-scoped session storage, entered through a masked field, and never logged.
The client streams `/stream` over fetch-based SSE (`eventsource-parser`) and sends the token as an `Authorization: Bearer` header, the same way it hydrates `/state`.
The Hub still accepts a `?token=` query on the stream, but that form is deprecated: it exists only as the escape hatch for native `EventSource` clients, which cannot set request headers, and its removal is deferred until after the owner's on-device wear test.
Fetch-based SSE also sidesteps Chrome's Local Network Access constraints, which matter here because the lab client is served via Tailscale rather than the Hub origin: when Chrome requires it, the fetch call can declare `targetAddressSpace` to reach a more-private address space, an option `EventSource` never gained.

Mouse movement simulates gaze, click simulates pinch/select, Left/Right moves through the ranked carousel, Enter selects the focused target, and holding V simulates push-to-talk.
The same focus and select controller is fed by WebXR target rays and `selectstart`/`select`/`selectend` events in immersive AR, whatever kind of input source produces them.

Build the standalone gate with:

```sh
bun run --cwd apps/xr-lab typecheck
bun run build:xr-lab
bun run test:xr-lab
```

## Hub setup

Start a real local Hub with the Giles adapter and voice enabled without persisting a generated token:

```sh
ASPEX_HUB_TOKEN='<one-time-lab-token>' \
ASPEX_GILES_ENABLED=true \
ASPEX_GILES_HOME=/home/rowe/giles \
ASPEX_VOICE_ENABLED=1 \
ASPEX_VOICE_MOCK=1 \
ASPEX_HUB_CORS_ORIGIN='http://localhost:4174' \
bun apps/hub/src/cli.ts hub
```

Read-only validation may hydrate `/state`, consume `/stream`, and issue a `status_query` through `/intents`.
Do not invoke dispatch, redirect, answer, deny, approve, or ship against the real Giles home during verification unless the owner authorizes that exact action.
Use the focused tests or the Giles dry-run path for consequential flows.

## Running on a device

WebXR immersive AR and microphone capture require a secure context on-device.
Build and serve the lab locally, then expose both the lab and Hub through trusted HTTPS endpoints on the private tailnet.
One concrete Tailscale Serve layout is:

```sh
bun run build:xr-lab
bun run --cwd apps/xr-lab preview
tailscale serve --bg --https=443 http://127.0.0.1:4174
tailscale serve --bg --https=4318 http://127.0.0.1:4317
```

Set the Hub CORS origin to the lab's exact HTTPS origin, for example `ASPEX_HUB_CORS_ORIGIN='https://devbox.example-tailnet.ts.net'`.
On the device's browser (Chrome on Android XR, Meta Quest Browser, or Edge on HoloLens 2), open that HTTPS lab origin, enter the HTTPS Hub URL such as `https://devbox.example-tailnet.ts.net:4318`, paste the token, save, and choose AR.
If the installed Tailscale CLI uses a newer Serve syntax, reproduce the same two local reverse proxies and verify both URLs from the device browser before pairing.
Instead of the second Serve proxy, the Hub can also terminate TLS itself via the `tls` config (`tailscale cert` provisioning; see the "TLS" section of [hub-api.md](hub-api.md)).
Because the lab is served from a different origin than the Hub, Chromium's Local Network Access policy (Chrome 142+) may prompt or block plain-http Hub calls from secure pages; keeping both endpoints HTTPS on the tailnet, as above, avoids that entirely.

The Android XR emulator (Android Studio) runs Chrome with WebXR `immersive-ar` and can stand in for hardware for everything except comfort and legibility numbers, which need a device on a face.

## Short wear-test checklist

This checklist applies to any additive-display WebXR device running the lab client; the comfort and distance numbers transfer across additive displays.

- Confirm primary content sits near 2 m, inside the 1.25-5 m comfort zone, fading out below 40 cm and clipping at 30 cm, with no depth animation on ambient cards.
- Confirm resting content sits 0-35 degrees below the horizon and the carousel fans out horizontally, not vertically.
- Confirm card text subtends at least 0.65-0.8 degrees of visual angle at 2 m and stays legible against a bright backdrop such as a window.
- Confirm one card resolves in a single 2-3 second glance: severity, project, and one action is a full card.
- Confirm the card is centered and completely visible in the useful waveguide FOV without head chasing.
- Confirm the device's available pointing inputs (gaze, articulated-hand pinch, controller ray, or tap) focus every control without resizing or shifting the card, and that the in-scene capability hint matches what the device actually offers.
- Hold push-to-talk, speak a safe status query, release, and confirm permission, recording, transcribing, and read-back states are legible.
- With a dry-run Hub, arm approve, redirect, dispatch, and ship, then verify cancel and timeout create no inbox artifact.
- Confirm ship requires entering `merge` or `ship`, or speaking either word after the ship prompt.
- Walk away from Wi-Fi briefly and verify last-known cards remain visible with offline or stale labeling before reconnect.

No physical device verification is claimed by the implementation workers; the desktop simulator and automated tests are the verified baseline, and on-device results are recorded per device when the owner runs the checklist.
Verified in desktop Chrome (2026-07): the simulator's gaze/select raycast path (pointer move focuses a control, discrete select activates it), the disabled-AR fallback when `immersive-ar` is unsupported, and the graceful microphone-denied path; input-source classification and the capability hint are covered by the simulated tests in `src/capabilities.test.ts`.
Device-only remainder: entering a real `immersive-ar` session, live `XRInputSource` connect/disconnect classification, and everything in the wear-test checklist; the Android XR emulator can cover the first two when available.
The lab's push-to-talk client creates an in-memory voice-session id and advances
its request generation for each utterance or cancellation so delayed deliveries
cannot advance a prior confirmation or dictation state.

## Exit-moment demo flows

The automated demonstrations in `apps/xr-lab/src/exitMoments.test.ts` use a faithful non-writing Hub test double.

1. A blocked real-shape `AttentionItem` exposes approve, the first request receives the Hub's 409 confirmation response, and only a second explicit confirm delivers with the same `intentId`.
2. Dispatch receives 409, a second confirm delivers with the same `intentId`, and a resulting orchestrator item arriving in a streamed snapshot enters the glance carousel.
3. Review-and-ship arms locally on the first pinch, sends no request at all, and sends one `confirmed: true` action with the explicit merge word only after the separate confirmation.

The voice-gateway tests separately demonstrate `dispatch …` followed by `confirm dispatch`, with the first client `intentId` preserved and no first-utterance delivery.
Real-Hub verification is deliberately read-only and is recorded separately from these simulated consequential flows.

## Device appendix: HoloLens 2

HoloLens 2 is a discontinued platform (OS support ends 2027-12-31) and receives no device-specific code investment; it remains the owner's wear-test jig because it is the owned device that can put the lab on a face.
The lab runs on it unmodified: its articulated hands surface as WebXR hand input sources and its head-gaze fallback rides the same select events, both of which the capability classifier already handles.

Pairing procedure: expose the lab and Hub over tailnet HTTPS as in "Running on a device", open the HTTPS lab origin in Edge on the HoloLens, enter the HTTPS Hub URL, paste the token, save, and choose AR.
Edge on HoloLens 2 requires the secure context for both WebXR and microphone capture, so plain HTTP origins will pair but cannot enter AR or record push-to-talk.
