# Dependency License Registry

Aspex core is licensed under Apache-2.0. This registry tracks the dependency
license posture for the Phase 0 shipped core.

As of this registry, the shipped core has no AGPL or GPL dependencies.

Sources checked:

- `package.json`
- workspace package manifests
- `bun.lock`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/Cargo.lock`
- installed package metadata where present

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

## Rust / Tauri

| Dependency | Use | License |
| --- | --- | --- |
| `tauri` | Desktop shell runtime | Apache-2.0 OR MIT |
| `tauri-build` | Tauri build script support | Apache-2.0 OR MIT |
| `tauri-plugin-shell` | Sidecar/process launch integration | Apache-2.0 OR MIT |
| `anyhow` | Rust error handling | Apache-2.0 OR MIT |

Tauri pulls a larger transitive Rust graph in `Cargo.lock`; keep that lockfile
reviewed when updating Tauri. Do not add AGPL/GPL crates to the shipped core.

## Policy

- Prefer Apache-2.0, MIT, BSD, or ISC dependencies.
- Do not add AGPL/GPL dependencies to the shipped core.
- Keep Hub dependencies Bun-compile-safe; avoid Node-native addons.
- Update this file in the same change as any dependency add, removal, or major
  version change.
