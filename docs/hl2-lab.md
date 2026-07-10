# HoloLens 2 WebXR lab

`apps/hl2-lab` is an unsupported, lab-only design instrument for the discontinued HoloLens 2 platform.
It is not a product client, an extension of the legacy cockpit, or a foundation for the deferred Android XR client.
It exists to test the three on-face exit moments against the real Hub/orchestrator protocol.

## Local simulator

Install and start the app from the repository root:

```sh
bun install
bun run --cwd apps/hl2-lab dev
```

Open `http://localhost:4174` in Chromium.
Pair the exact Hub URL and local bearer token in Settings.
The Hub URL is persisted for convenience, while the bearer token is kept only in tab-scoped session storage, entered through a masked field, and never logged.
The EventSource token query is constructed only in memory because browsers cannot attach authorization headers to `EventSource`.

Mouse movement simulates gaze, click simulates pinch, Left/Right moves through the ranked carousel, Enter selects the focused target, and holding V simulates push-to-talk.
The same focus and select controller is fed by WebXR target rays and `selectstart`/`select`/`selectend` events in immersive AR.

Build the standalone gate with:

```sh
bun run --cwd apps/hl2-lab typecheck
bun run build:hl2-lab
bun run test:hl2-lab
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

## HoloLens 2 run

WebXR immersive AR and microphone capture require a secure context on-device.
Build and serve the lab locally, then expose both the lab and Hub through trusted HTTPS endpoints on the private tailnet.
One concrete Tailscale Serve layout is:

```sh
bun run build:hl2-lab
bun run --cwd apps/hl2-lab preview
tailscale serve --bg --https=443 http://127.0.0.1:4174
tailscale serve --bg --https=4318 http://127.0.0.1:4317
```

Set the Hub CORS origin to the lab's exact HTTPS origin, for example `ASPEX_HUB_CORS_ORIGIN='https://devbox.example-tailnet.ts.net'`.
On HoloLens 2, open that HTTPS lab origin in Edge, enter the HTTPS Hub URL such as `https://devbox.example-tailnet.ts.net:4318`, paste the token, save, and choose AR.
If the installed Tailscale CLI uses a newer Serve syntax, reproduce the same two local reverse proxies and verify both URLs from Edge before pairing.

## Short wear-test checklist

- Confirm the card is centered and completely visible in the useful waveguide FOV without head chasing.
- Confirm gaze and articulated-hand pinch focus every control without resizing or shifting the card.
- Hold push-to-talk, speak a safe status query, release, and confirm permission, recording, transcribing, and read-back states are legible.
- With a dry-run Hub, arm approve, redirect, dispatch, and ship, then verify cancel and timeout create no inbox artifact.
- Confirm ship requires entering `merge` or `ship`, or speaking either word after the ship prompt.
- Walk away from Wi-Fi briefly and verify last-known cards remain visible with offline or stale labeling before reconnect.

No physical HoloLens 2 verification is claimed by the initial implementation worker.
The lab's push-to-talk client creates an in-memory voice-session id and advances
its request generation for each utterance or cancellation so delayed deliveries
cannot advance a prior confirmation or dictation state.

## Exit-moment demo flows

The automated demonstrations in `apps/hl2-lab/src/exitMoments.test.ts` use a faithful non-writing Hub test double.

1. A blocked real-shape `AttentionItem` exposes approve, the first request receives the Hub's 409 confirmation response, and only a second explicit confirm delivers with the same `intentId`.
2. Dispatch receives 409, a second confirm delivers with the same `intentId`, and a resulting orchestrator item arriving in a streamed snapshot enters the glance carousel.
3. Review-and-ship arms locally on the first pinch, sends no request at all, and sends one `confirmed: true` action with the explicit merge word only after the separate confirmation.

The voice-gateway tests separately demonstrate `dispatch …` followed by `confirm dispatch`, with the first client `intentId` preserved and no first-utterance delivery.
Real-Hub verification is deliberately read-only and is recorded separately from these simulated consequential flows.
