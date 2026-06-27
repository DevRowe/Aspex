# Contributing

Aspex is a personal project with best-effort support. Contributions are welcome,
but maintainers may decline changes that expand scope, add operational burden,
or weaken the Phase 0 safety model.

## Development Setup

Install dependencies:

```sh
bun install
```

Run the required local checks before proposing a change:

```sh
bun run typecheck
bun test
bun run lint
```

Run mock mode while developing the cockpit:

```sh
bun apps/hub/src/cli.ts hub --mock
bun run --cwd apps/web dev
```

Desktop development uses a separately running Hub:

```sh
bun run --cwd apps/desktop dev
```

## Scope Rules

- Keep Phase 0 local-only and telemetry-free.
- Do not execute agent-authored code in the Hub or web origin.
- Do not render agent HTML or JavaScript.
- Do not use `eval` or dynamic import for agent output.
- Preserve the Item/Signal vocabulary in `CONTEXT.md`.
- Preserve attention ownership from ADR-0002.
- Preserve liveness behavior from ADR-0003.
- Keep Claude Code read-only in Phase 0 per ADR-0004.
- Do not add AGPL/GPL dependencies to the shipped core.

Future Labs work such as voice, spatial UI, preview isolation, and delegation
belongs in later-phase planning until it has explicit task cards.

## Dependency Changes

When adding or replacing a dependency:

1. Prefer small, permissively licensed packages.
2. Avoid native Node addons in Hub code; the Hub must stay Bun-compile-safe.
3. Update `docs/licenses.md`.
4. Re-run the full verification suite.

## Security Changes

Security-sensitive changes should update `docs/threat-model.md` in the same
patch. If the change affects adapter ownership, liveness, process boundaries, or
action safety, add or update an ADR before changing code.
