# Card 15 — `adapter-github` (viewer-centric, two-way)

## Goal
The universal adapter. Discovers Items via **viewer-centric search** (ADR-0006), maps PRs/checks/reviews to **one Item per PR** on the correct rung (ADR-0002 grain), respects the rate budget, and performs two-way actions (approve / merge / comment / re-run). github owns PR-lifecycle attention.

## Depends on
- Card 02 (Adapter), Card 08 (registry), Card 09 (config provides token + allowlist + pollIntervalMs).

## Files to create
```
packages/adapter-github/package.json
packages/adapter-github/src/index.ts        # GithubAdapter implements Adapter
packages/adapter-github/src/discover.ts      # search queries -> raw PRs
packages/adapter-github/src/map.ts           # raw PR -> AttentionItem (reason, actions)
packages/adapter-github/src/actions.ts       # approve/merge/comment/re-run
packages/adapter-github/test/map.test.ts
packages/adapter-github/test/discover.test.ts
```

## Dependencies
```bash
bun add @octokit/rest
```

## Discovery (ADR-0006 — DO NOT enumerate repos)
Run these searches (authenticated as the token's user, `@me`):
- `is:open is:pr review-requested:@me`  → reason `review_requested`
- `is:open is:pr author:@me`            → fetch checks → `failing_ci` | `awaiting_merge`
- `is:open is:pr assignee:@me`          → `review_requested`/context
- plus, for each `allowlist` author/repo, `is:open is:pr author:<x>` or `repo:<x>` (covers agent **bot identities**).

For each author PR, fetch **check runs / combined status** + review decision to classify:
- any failing/❌ check → `failing_ci` (rung 2)
- all green + approved + mergeable → `awaiting_merge` (rung 4)
- otherwise → Ambient (working) unless review-requested applies.

**Dedup to one Item per PR** by `github:pr:owner/repo#number`. If a PR matches several queries, keep the **highest rung** as `reason` and union the actions.

## Rate budget
- Search API ≈ **30 requests/min** (separate from the 5k/hr REST budget) → keep `pollIntervalMs ≥ 60_000` and few queries per cycle.
- Use **conditional requests** (ETag / `If-None-Match`) on check/status fetches; a `304` costs no quota.
- On a successful cycle → `ctx.heartbeat("github")` (keeps Items `live`). On rate-limit/network failure → log + DO NOT heartbeat (Items decay honestly — ADR-0003).

## Mapping → actions
| classification | reason | state | actions |
|---|---|---|---|
| review requested of me | `review_requested` | needs_review | `approve` (medium, confirm), `comment` (safe), open(deep-link) |
| my PR, CI failing | `failing_ci` | needs_review | `rerun` (medium), view-CI (deep-link) |
| my PR, green+approved | `awaiting_merge` | needs_review | `merge` (**dangerous**, requiresConfirmation) |
| working/other | `ambient` | working | open (deep-link) |

`summary` is a deterministic template, e.g. `"#42 Fix nav — CI failing on 2 checks"`. **No LLM.**

## Stub
```ts
export class GithubAdapter implements Adapter {
  id = "github";
  async start(ctx: AdapterContext) { /* poll loop on pollIntervalMs: discover -> map -> ctx.emit per Item; ctx.heartbeat on success */ }
  listActions(itemId: string): Action[] { /* from last mapped Item */ }
  async runAction(itemId, actionId, payload) { /* actions.ts via Octokit */ }
  async stop() { /* clear interval */ }
}
```

## Acceptance check
```bash
bun test packages/adapter-github   # green (Octokit mocked with fixtures)
```
Tests must prove:
- A PR matching BOTH `review-requested` and `author` with failing CI → **one** Item, `reason: "failing_ci"`, actions include both review and re-run (grain + ownership).
- A green+approved author PR → `awaiting_merge` with a `dangerous` `merge` action.
- `runAction(merge)` calls Octokit's merge method; `runAction(approve)` calls the review method.
- A search returning many repos issues **one set of search calls**, not per-repo calls (ADR-0006).

Optional live smoke (manual, with a real token): `aspex hub` (no mock) → `/state` shows your real review-requested PRs.

## Out of scope / do NOT do
- Do NOT enumerate repositories (ADR-0006). Viewer-centric search only.
- Do NOT exceed the search rate limit — interval ≥ 60s.
- No webhooks/Funnel (Phase 0 is poll-only). No GitHub App — a fine-grained PAT from config.
