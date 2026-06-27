# Card 16 — `adapter-claude-code` (read-only, hook-fed)

## Goal
Surface Claude Code sessions that need you. **Read-only** (ADR-0004): in-flight attention only (`blocked`, `error`), completion is Ambient (ADR-0002), liveness from `PostToolUse` heartbeats (ADR-0003). Includes the `aspex hooks install/uninstall` installer and the `aspex hook-relay` command.

## Depends on
- Card 02 (Adapter), Card 07 (`POST /signals/claude-code`), Card 09 (CLI command slots).

## Files to create
```
packages/adapter-claude-code/package.json
packages/adapter-claude-code/src/index.ts        # ClaudeCodeAdapter (maps incoming hook signals)
packages/adapter-claude-code/src/hooks-install.ts # install/uninstall into ~/.claude/settings.json
packages/adapter-claude-code/src/relay.ts         # hook-relay: stdin JSON -> POST /signals/claude-code
packages/adapter-claude-code/test/map.test.ts
packages/adapter-claude-code/test/install.test.ts
```

## Hooks installed (user-level `~/.claude/settings.json`)
Each runs `aspex hook-relay --event <Name>`:
| Hook | Why | Maps to |
|---|---|---|
| `PostToolUse` | **heartbeat** (ADR-0003) | `ctx.heartbeat` for the session; keeps it `live` |
| `Notification` | agent needs input/permission | `state: blocked`, `reason: blocked_on_human`, attentionRequired, `deepLink` |
| `Stop` | session finished | `state: done`, Ambient (attentionRequired false — ADR-0002/0004) |
| `SubagentStop` | subagent finished | update/ambient |

> `~/.claude/settings.json` location: `process.env.CLAUDE_CONFIG_DIR ?? ~/.claude`. On Windows that's `%USERPROFILE%\.claude\settings.json`.

## `aspex hooks install`
- Read existing settings.json (or `{}`).
- **Idempotently merge** Aspex's hook entries under `hooks` — match by the `aspex hook-relay` command so re-running doesn't duplicate; don't touch the user's other hooks.
- Write back (pretty JSON), after a backup copy.
- `aspex hooks uninstall` removes only Aspex's entries.

## `aspex hook-relay --event <Name>`
```ts
// 1. read all of stdin (Claude Code passes hook JSON: session_id, transcript_path, cwd, hook_event_name, tool_name?, message?)
// 2. read hub port from config (same loader as the Hub).
// 3. build a Signal: id = claude-code:session:<session_id>, source "claude-code",
//    state/reason per the event (PostToolUse -> a heartbeat marker), project = basename(cwd),
//    deepLink = a terminal-focus URL or the cwd path.
// 4. POST to http://127.0.0.1:<port>/signals/claude-code, short timeout, exit fast (Claude Code waits on hooks!).
// 5. NEVER block or error the hook — on failure, exit 0 quietly (don't break the user's Claude Code).
```

## Adapter mapping
The adapter owns interpreting the posted signals for source `claude-code` (the HTTP `/signals/:source` just calls `applySignal`, so the relay can pre-shape the Signal, OR the adapter exposes a mapping the Hub calls). Simplest: the **relay pre-shapes** the Signal fully; the adapter's job is `listActions` (always `[]`, read-only) + `runAction` (returns `{ ok:false, message:"read-only in Phase 0" }`).

`PostToolUse` is special: the relay posts a `state: working` signal flagged as a heartbeat; the Hub treats it as `ctx.heartbeat("claude-code")` for that session and refreshes `staleAfter` WITHOUT flipping a blocked/done state back to working. (Implement: a tiny rule in the claude-code signal handling — heartbeat refresh only, don't overwrite a `blocked` state.)

## Acceptance check
```bash
bun test packages/adapter-claude-code   # green
```
Tests must prove:
- Posting a `Notification` signal → an Item `state: blocked`, `reason: blocked_on_human`, attentionRequired true, `actions: []`, `deepLink` set.
- Posting a `Stop` signal → `state: done`, Ambient, attentionRequired **false** (ADR-0002/0004).
- A `PostToolUse` heartbeat refreshes liveness but does NOT turn a `blocked` Item back into `working`.
- `hooks install` then `uninstall` on a temp settings.json round-trips it exactly (and is idempotent on double-install).
- `runAction` returns read-only refusal (no PTY — ADR-0004).

Manual smoke: `aspex hooks install`; run a real Claude Code session that asks for permission → a `blocked` card appears; finish it → it moves to Ambient.

## Out of scope / do NOT do
- **No PTY / no writing into sessions** (ADR-0004). Deep-link only.
- Do not register `PreToolUse`/`UserPromptSubmit`/other hooks — only the four above.
- The relay must never throw or hang — failing silently is correct (don't degrade the user's Claude Code).
- Do not auto-install at adapter start; installation is the explicit `aspex hooks install` command (user-consented).
