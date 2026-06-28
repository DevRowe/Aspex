# Card 38 — Docker preview engine

## Goal
The real `PreviewEngine` backed by the **`docker` CLI** (ADR-0017): probe availability, **pull-not-build**, run a declared image/compose with a `127.0.0.1` port mapping, `--rm`, a recognizable name, CPU/memory caps, and env; detect readiness and exit; teardown; and **sweep** leftover `aspex-preview-*` at startup. Shells out via `Bun.spawn` — **no native Docker SDK** (keeps the Hub Bun-compile-safe, ADR-0008). This card is **verified with Docker on the dev machine, not in CI**.

## Depends on
- Card 37 (`PreviewEngine`, `PreviewHandle`, `ExitInfo`), Card 36 (`PreviewSpec`).

## Files to create
```
apps/hub/src/preview/engineDocker.ts
```

## Behaviour
- **`available()`** — `docker version` (or `docker info`) via `Bun.spawn`; `false` on non-zero exit or timeout. Never throws.
- **`boot(spec)`** (image path):
  1. Allocate a free **`127.0.0.1`** host port (bind-probe an ephemeral port, then release).
  2. Optional explicit `docker pull <image>` (declared image only — **never `docker build`**).
  3. `docker run -d --rm --name aspex-preview-<previewId> -p 127.0.0.1:<host>:<spec.port>` plus `--cpus`/`--memory` from `spec.limits` and `-e KEY=VAL` from `spec.env`, then `<image>`.
  4. **Readiness:** poll until the mapped port accepts a TCP connection (or `docker inspect` health) up to a timeout → resolve `url = http://127.0.0.1:<host>`. Timeout → stop the container + reject.
  5. `PreviewHandle.stop()` → `docker rm -f aspex-preview-<previewId>` (idempotent). `onExit` → a background `docker wait` (or poll `docker inspect .State.Running`) that fires `ExitInfo` once when the container exits.
- **`boot(spec)`** (compose path): `docker compose -f <spec.composeFile> -p aspex-preview-<previewId> up -d`; readiness + `url` from the documented mapped port; `stop()` → `docker compose ... down`. Document that compose files must map the preview port to `127.0.0.1`.
- **`sweep()`** — `docker ps -aq --filter name=aspex-preview-` → `docker rm -f` each. Called at Hub startup (wired in card 44) so a prior crash leaves no orphans.
- All commands `127.0.0.1`-bound; never publish to `0.0.0.0`. Avoid putting secrets on argv where `--env-file` is cleaner (document).

## Steps
1. A small `run(args): Promise<{code, stdout, stderr}>` helper over `Bun.spawn`.
2. `available`, `boot` (image), `stop`, `onExit` (via `docker wait`).
3. Compose path (`up -d` / `down`).
4. `sweep`.
5. **Docker-gated manual check** (not a CI unit test) — see acceptance.

## Acceptance check
**Requires Docker running.** With a tiny static image (e.g. `nginx:alpine` serving on 80), a temp spec `{ image:"nginx:alpine", port:80, trust:"trusted" }`:
```
# pseudo-driver (scripts/check-docker-engine.ts) or a Docker-tagged test:
bun run scripts/check-docker-engine.ts
```
Expected: `available()` true; `boot` → a `127.0.0.1:<host>` url that `curl` serves the nginx page; `stop` removes the container (`docker ps` clean); `sweep` removes a manually-left `aspex-preview-*`. **This check is excluded from the CI `bun test` run.**

## Out of scope / do NOT do
- **No `docker build`** and no branch/worktree/checkout (ADR-0014) — pull-and-run declared artifacts only.
- No native Docker SDK / dockerode — CLI via `Bun.spawn` only (ADR-0008).
- No non-loopback publishing; no broker/HTTP/web logic.
- Do not add this card's real-Docker check to the CI job (mock-first stays the CI path — card 45).
