# Aspex Glimmer lab (glance-tier prototype)

A minimal Android client that renders the Aspex attention carousel as a Glimmer glanceable card on the AI Glasses tier of Android XR.
It is a phone-resident app: all logic (Hub connection, ranking consumption, confirm flow) runs on the phone, and Jetpack Projected projects the rendered UI onto the glasses display.
This is the monorepo's first non-Bun component; it is a self-contained Gradle project, deliberately not wired into `bun test`/`bun run typecheck`.

Like `apps/hl2-lab`, this is an unsupported lab instrument, not a product target.
Glimmer's stated design principles are the design contract here: glanceable not immersive, reality wins, and every read should complete in 2-3 seconds.

## What it does

- Authenticates to the real Hub with the ADR-0023 bearer token (`Authorization: Bearer`, including on the SSE stream - the deprecated `?token=` fallback is never used).
- Subscribes to `GET /stream` and renders the top `needsMe` item as one Glimmer `ActionCard`: severity + reason, project, a 3-line summary, and the item's first action as a single button.
- Drives the action through the Hub's real two-step confirmation gate on `POST /actions/:itemId/:actionId`: first tap posts unconfirmed, a 409 flips the card into a confirm state, second tap retries with `confirmed: true` and the same `intentId` (so the Hub's intent ledger dedupes retries end-to-end).
- Sends a `status_query` direction intent to `POST /intents` from a "Status" button - the stub attachment point for the "status" voice phrase once the emulator voice simulation is exercised.
- A phone-side companion activity shows connection health and hand-launches the glasses surface via `ProjectedContext.createProjectedActivityOptions`.

Everything else (lists, multiple actions, dispatch, evidence, deep links) is deliberately out of scope for the skeleton.

## Toolchain

| Piece | Version | Note |
| --- | --- | --- |
| JDK | 21 | Gradle toolchain pinned via `jvmToolchain(21)` |
| Gradle | 9.6.1 | wrapper committed |
| Android Gradle Plugin | 9.3.0 | AGP 9 has built-in Kotlin; do not add `org.jetbrains.kotlin.android` |
| compileSdk | 37 | required by Glimmer >= 1.0.0-alpha10; install `platforms;android-37.0` |
| Compose Glimmer | 1.0.0-alpha15 | developer preview, expect churn |
| Jetpack Projected | 1.0.0-alpha10 | developer preview, expect churn |

## SDK setup (any OS)

1. Install a JDK 21 and set `JAVA_HOME`.
2. Install the Android SDK (via Android Studio, or `commandlinetools` + `sdkmanager`) and set `ANDROID_HOME` or write `sdk.dir` into `local.properties` here.
3. Install packages: `platform-tools`, `platforms;android-37.0`, `build-tools;37.0.0`.
4. Build: `./gradlew :app:assembleDebug` (first run downloads dependencies from Google Maven).
5. Unit tests: `./gradlew :app:testDebugUnitTest` - includes a wire-format test against a `/state` snapshot captured verbatim from the real Hub.

## Emulator setup (AI Glasses)

The AI Glasses emulator ships only inside **Android Studio canary** builds; its system images are not in the `sdkmanager` stable or canary repository channels, so this cannot be provisioned headlessly.
Follow the [official AVD guide](https://developer.android.com/develop/xr/jetpack-xr-sdk/run/create-avds/glasses):

1. Install the latest Android Studio **canary** and open this directory (`apps/glimmer-lab`) as the project.
2. Device Manager > Create Virtual Device > form factor **XR** > profile **Display Glasses** > newest compatible system image.
3. Create the required companion **Phone** AVD: API **CANARY** preview, the "16 KB Page Size Google Play" image for your host arch.
4. Pair them: glasses AVD overflow menu > **Pair Glasses** > pick the phone AVD > accept the permission prompts on the phone.

## Run steps

1. Start the Hub on the host: `bun run --cwd apps/hub dev`. Note the token from `~/.aspex/config.json` (`auth.token`) or `ASPEX_HUB_TOKEN`.
2. Point the app at the Hub. Defaults are `http://10.0.2.2:4317` (the emulator's alias for host loopback) and an empty token; override without touching the repo via `~/.gradle/gradle.properties` or the CLI:

   ```sh
   ./gradlew :app:installDebug -PaspexHubToken=<token from ~/.aspex/config.json>
   ```

3. Install on the **phone** AVD (the app is phone-resident): `adb -s <phone-avd> install app/build/outputs/apk/debug/app-debug.apk`, or `Run` on the phone AVD from Android Studio.
4. Open "Aspex Glance" on the phone; it shows Hub connection state. Tap **Launch on glasses** (or use the emulator's voice simulation: "open Aspex Glance") to start the projected activity on the glasses AVD.
5. Feed the Hub attention items (real adapters, or `POST /signals/:source`) and watch the card update; use the glasses emulator's touchpad simulation to focus/tap the action button and drive the 409 confirm round-trip.

## Verification runbook (Windows side)

This app was developed and gate-checked (assembleDebug, lint, unit tests) headlessly on WSL2, where the AI Glasses emulator cannot run: it needs Android Studio canary plus a GUI pairing flow between two AVDs, and its system images are unavailable to `sdkmanager`.
To verify on the Windows host:

1. Install Android Studio canary on Windows and open `apps/glimmer-lab` (via `\\wsl$` or a Windows checkout).
2. Complete "Emulator setup" and "Run steps" above. The Hub can stay in WSL2, but bind it beyond loopback (`hubBind`) or port-proxy, because a Windows emulator's `10.0.2.2` reaches the *Windows* loopback, not WSL2's; `-PaspexHubUrl` accepts any reachable URL.
3. Confirm, in order: (a) phone app shows "Live"; (b) glasses card renders the top item within a beat of a new signal; (c) first tap on a `requiresConfirmation` action shows the confirm card, second tap lands the action exactly once (check the adapter/orchestrator side); (d) "Status" shows the needs-me count line; (e) voice "open Aspex Glance" launches the projected activity.
4. Record wear-test-style notes (read time, focus ergonomics) in `docs/` alongside the HL2 notes if the session produces design findings.

## Known gaps / protocol notes

- The 409 confirmation gate is recognized by status code alone; the body is prose. See the protocol feedback in the PR that introduced this app (RFC 9457 `confirmation-required` problem type, per report `aspex-protocol-design-d1` Decision 1).
- `POST /intents` answers a non-JSON `404 Not Found` when no orchestrator is configured; the client treats any non-200 as "status unavailable".
- ASR voice input (`androidx.xr.glimmer` voice indicator + Projected ASR) is stubbed by buttons; wiring it is cheap only once the emulator is in play.
