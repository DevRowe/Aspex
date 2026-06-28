# Dependency License Registry

Aspex core is licensed under Apache-2.0. This registry tracks the dependency
license posture for the shipped core through Phase 3.

As of this registry, the shipped core has no AGPL or GPL dependencies.

Sources checked:

- `package.json`
- workspace package manifests
- `bun.lock`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/Cargo.lock`
- installed package metadata where present
- `services/voice-server/pyproject.toml`
- reference voice service source files
- Phase 3 adapter package manifests

## JavaScript and TypeScript

| Dependency | Use | License |
| --- | --- | --- |
| `hono` | Hub HTTP, REST, SSE | MIT |
| `@octokit/rest` | GitHub REST adapter | MIT |
| `@octokit/*` family from lockfile | Octokit request, endpoint, auth, pagination helpers | MIT |
| `react` | Web UI runtime | MIT |
| `react-dom` | Web UI runtime | MIT |
| `zustand` | Web state store | MIT |
| `@tauri-apps/cli` | Desktop build/dev tooling | Apache-2.0 OR MIT |
| `@biomejs/biome` | Lint and format tooling | MIT OR Apache-2.0 |
| `typescript` | Typechecking/build tooling | Apache-2.0 |
| `bun-types` | Bun TypeScript types | MIT |
| `vite` | Web build/dev server | MIT |
| `@vitejs/plugin-react` | Vite React integration | MIT |
| `tailwindcss` | Web CSS build tooling | MIT |
| `postcss` | CSS processing | MIT |
| `autoprefixer` | CSS processing | MIT |
| `@types/react` | Type declarations | MIT |
| `@types/react-dom` | Type declarations | MIT |

Workspace packages under `@aspex/*` are first-party Aspex packages.

Bun built-ins used by the Hub, including `Bun.serve` and `bun:sqlite`, are part
of the Bun runtime/toolchain rather than npm dependencies vendored by this repo.

Browser audio capture uses built-in Web APIs (`getUserMedia`,
`MediaRecorder`, and `HTMLAudioElement`), not a JavaScript package dependency.

Preview Deck uses existing browser primitives: `iframe`, `fetch`, and the
existing Hub SSE stream. It adds no npm runtime dependency. The Docker Preview
engine invokes the host's `docker` command-line tool as an optional external
capability; Aspex does not link a Docker SDK, native addon, daemon library, or
vendored Docker component.

Phase 3 free-form intent uses Bun `fetch` to call a configured Ollama-compatible
HTTP endpoint. It adds no npm runtime dependency for the Intent service.

Phase 3 codex, opencode, and cursor adapters are first-party workspace packages
that depend only on `@aspex/schema`. The Hub links those packages but does not
vendor code from the host-installed codex CLI, opencode CLI/server, or Cursor.

## Rust / Tauri

| Dependency | Use | License |
| --- | --- | --- |
| `tauri` | Desktop shell runtime | Apache-2.0 OR MIT |
| `tauri-build` | Tauri build script support | Apache-2.0 OR MIT |
| `tauri-plugin-shell` | Sidecar/process launch integration | Apache-2.0 OR MIT |
| `anyhow` | Rust error handling | Apache-2.0 OR MIT |

Tauri pulls a larger transitive Rust graph in `Cargo.lock`; keep that lockfile
reviewed when updating Tauri. Do not add AGPL/GPL crates to the shipped core.

## Reference Voice Service

`services/voice-server` is a separate Python reference service. The Hub reaches
it over HTTP; the service is not imported or linked into the core app packages.
Mock mode loads no model dependencies and is the mode used by CI.

| Component | Use | License posture |
| --- | --- | --- |
| FastAPI | Reference HTTP service for `/transcribe`, `/speak`, `/health` | Permissive project dependency, commonly MIT |
| Uvicorn | ASGI server for the reference service | Permissive project dependency, commonly BSD-3-Clause |
| Pydantic | Request/response models through FastAPI | Permissive project dependency, commonly MIT |
| python-multipart | Form/runtime support dependency declared by the service | Permissive project dependency, commonly Apache-2.0 |
| pytest | Reference service contract tests | Permissive test dependency, commonly MIT |
| httpx | FastAPI TestClient transport/test dependency | Permissive test dependency, commonly BSD-3-Clause |

Real STT/TTS mode is host-provisioned and optional:

- Parakeet is used through NVIDIA NeMo in the reference STT wrapper. Install the
  NeMo/PyTorch/CUDA stack and model on the GPU host following NVIDIA's current
  terms for that host. These packages and model weights are not vendored by
  Aspex.
- Piper is used through a local Piper command-line binary and voice model. The
  wrapper shells out to the binary and returns WAV bytes. Piper binaries and
  voice models are installed separately from this repo; review the specific
  binary and model licenses selected for your host.
- `ffmpeg` may be used by the Parakeet wrapper to normalize browser audio before
  transcription. It is an external host tool, not vendored into the core app.

## Phase 3 Intent and Agent Tools

These components are host-installed or consumed over data protocols. They are
not vendored into the Aspex core dependency graph.

| Component | Use | License posture |
| --- | --- | --- |
| Ollama | Optional local Intent service reached over `/api/chat` | Host-installed tool; review the installed version's license on the target machine. |
| Ollama model weights | Selected by `intent.model`, for example `llama3.1` | Host-installed weights; each model has its own license and use restrictions. The user must review the selected model before use. |
| codex CLI | Optional source that can call `aspex hook-relay` through its notify mechanism | Host-installed tool; no codex CLI code is linked or vendored by Aspex. Review the installed tool's license separately. |
| opencode CLI/server | Optional local source observed through `opencode serve` `/event` SSE | Host-installed tool/server; no opencode code or SDK is linked or vendored by Aspex. Review the installed tool's license separately. |
| Cursor | Optional cloud-origin `statusChange` payload and deep-link source | Webhook payload plus deep-link only. No Cursor code is linked, imported, or vendored by Aspex. |

No AGPL/GPL dependency entered the shipped core in Phase 3. If a future change
adds a real SDK or vendored client for any of these tools, update this registry
in the same change and review its transitive licenses.

## Deferred Preview Components

The untrusted pixels lane is not shipped in Phase 2. Components discussed for
that lane, including neko/WebRTC streaming, screenshot streaming helpers, and
`model-viewer` or other glTF/AR rendering packages, have not been added to the
core dependency graph. Review their licenses before any later ADR or card adds
them.

## Policy

- Prefer Apache-2.0, MIT, BSD, or ISC dependencies.
- Do not add AGPL/GPL dependencies to the shipped core.
- Keep Hub dependencies Bun-compile-safe; avoid Node-native addons.
- Keep Docker and other Preview engines as CLI tools, services, or pluggable
  boundaries unless a later ADR explicitly changes that boundary.
- Keep model/tooling components for voice as separate services or host tools
  unless a later ADR explicitly changes that boundary.
- Keep local LLMs, model weights, and agent CLIs as host-installed tools or
  HTTP/data boundaries unless a later ADR explicitly changes that boundary.
- Update this file in the same change as any dependency add, removal, or major
  version change.
