# Preview Deck

The Preview Deck is the Phase 2 Labs subsystem that boots, isolates, shows, and
disposes declared Preview specs. It is opt-in, local-first, and separate from the
world-model: a Preview is never an Item, never ranked, and never appears in
needs-me.

## Spec Format

Preview specs live in the local `~/.aspex` config registry. Aspex boots what the
spec declares; it never builds an image, checks out a branch, computes a command,
or infers what to run.

```json
{
  "previews": {
    "enabled": true,
    "engine": "docker",
    "maxConcurrent": 2,
    "limits": {
      "cpus": "1",
      "memory": "512m",
      "idleTtlSec": 600
    },
    "specs": [
      {
        "id": "aspex-web",
        "name": "Aspex Web",
        "engine": "docker",
        "image": "ghcr.io/brocorp/aspex-web:preview",
        "port": 3000,
        "trust": "trusted",
        "itemId": "github:pr:BroCorp/Aspex#45",
        "env": {
          "NODE_ENV": "production"
        },
        "limits": {
          "cpus": "1",
          "memory": "512m",
          "idleTtlSec": 300
        }
      },
      {
        "id": "untrusted-demo",
        "name": "Untrusted Demo",
        "engine": "docker",
        "image": "example/untrusted-demo:latest",
        "port": 8080,
        "trust": "untrusted"
      }
    ]
  }
}
```

The spec shape is:

```ts
interface PreviewSpec {
  id: string;
  name: string;
  engine: "docker" | "compose" | "mock";
  image?: string;
  composeFile?: string;
  port: number;
  trust: "trusted" | "untrusted";
  itemId?: string;
  env?: Record<string, string>;
  limits?: { cpus?: string; memory?: string; idleTtlSec?: number };
}
```

Exactly one of `image` or `composeFile` declares what to boot. Images are pulled,
not built. `env` is for non-secret runtime settings only; Hub credentials and
tokens must never be placed in a Preview spec.

## Trust Lanes

v1 ships the trusted-iframe lane only. A `trusted` Preview is rendered from its
own `http://127.0.0.1:<allocated-port>` origin inside a sandboxed iframe.
"Trusted" means Aspex will display the app DOM in that isolated frame; it does
not mean the Preview receives Hub credentials or cockpit access.

`untrusted` specs are accepted in the registry but are not bootable in v1. The
pixels lane for arbitrary output, such as neko/WebRTC or screenshot streaming,
is deferred by ADR-0016.

## Lifecycle

- Boot is explicit: only a user action starts a Preview.
- Boot is declared: only registry specs are booted.
- Boot is pull-not-build: Docker may pull a declared image, but Aspex never
  builds, checks out, or computes project code.
- Previews are bounded by `maxConcurrent`, CPU, memory, and idle TTL.
- Reaping happens on explicit close, idle TTL expiry, Hub shutdown, and Docker
  startup sweep for leftover `aspex-preview-*` containers.
- Crash is visible: unexpected exit becomes `crashed` with a message and no
  auto-restart.
- Terminal snapshots may remain visible as `stopped` or `crashed`; no live
  `booting` or `ready` Preview should leak after stop or shutdown.

## Security Model

The Hub and cockpit remain bound to `127.0.0.1`. Preview container ports also
bind to `127.0.0.1`, but to a different port and therefore a different browser
origin from the cockpit.

The iframe contract is:

```html
<iframe
  src="http://127.0.0.1:<allocated-port>"
  sandbox="allow-scripts allow-forms allow-same-origin"
  referrerpolicy="no-referrer"
  allow=""
></iframe>
```

The sandbox deliberately withholds `allow-top-navigation`, `allow-popups`, and
`allow-modals`. There is no v1 postMessage app protocol. No Hub cookies, bearer
tokens, GitHub tokens, database handles, or voice credentials cross into a
Preview.

## REST and SSE Contract

| Method and path | Purpose |
| --- | --- |
| `GET /previews/specs` | Return declared specs with `trust` and optional `itemId`. |
| `POST /previews` | Boot `{ "specId": "..." }`; returns `201` with the Preview snapshot. |
| `GET /previews` | Return current Preview snapshots. |
| `GET /previews/:id` | Return one Preview snapshot or `404`. |
| `DELETE /previews/:id` | Stop a Preview; returns `204` on success. |
| `GET /stream` | Existing Hub SSE stream; emits `preview` events. |

Preview state is `booting | ready | crashed | stopped`. The expected happy path
is streamed as `booting -> ready -> stopped`; crashes stream as `crashed` with a
message. A ready Preview includes `url: "http://127.0.0.1:<allocated-port>"`.

Refusals are explicit:

- Unknown spec: `404`.
- Untrusted spec while pixels lane is deferred: `403`.
- Past `maxConcurrent`: `429`.
- Malformed request: `400`.

## Guardrails

14. Pixels or sandbox, never cockpit code. A Preview's content never executes in
    the cockpit origin.
15. Boot declared specs, never build or compute.
16. No Hub credentials ever cross into a Preview.
17. Disposable and bounded: no orphan containers; caps are enforced.
18. Mock-first: broker and HTTP tests pass with no Docker.

## Deferred Follow-Ups

- Pixels/neko lane for untrusted or arbitrary output.
- Adapter-surfaced specs, where adapters can expose candidate specs without
  changing the declared-spec boot boundary.
- glTF, AR, USDZ, spatial tiles, and WebXR shell work.
- Later engine backends such as E2B or microsandbox behind the same Preview
  engine interface.
