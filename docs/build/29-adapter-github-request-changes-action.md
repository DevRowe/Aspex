# Card 29 — `adapter-github`: `request_changes` action

## Goal
Add a `request_changes` action to the github adapter — a REST review with `event: REQUEST_CHANGES` and a body — symmetric with the existing `approve`. This is the target for the dictated "reject and say …" verdict (ADR-0012). Small extension to card 15; no new discovery, no new Items.

## Depends on
- Card 15 (`adapter-github`: `actions.ts`, the map → actions table). Card 02 (`Action`).

## Files to edit
```
packages/adapter-github/src/actions.ts     # add requestChanges()
packages/adapter-github/src/map.ts         # add the action to review-requested Items
packages/adapter-github/test/map.test.ts   # extend
packages/adapter-github/test/actions.test.ts
```

## Behaviour
- On a **review-requested** Item (the one that already offers `approve` + `comment`), also offer:
  ```ts
  { id: "request_changes", label: "Request changes", risk: "safe", requiresConfirmation: false }
  ```
  `risk: "safe"` / `requiresConfirmation: false` is correct — the *voice* read-back-before-post (card 26/27) is what guards the dictated body, not the action risk tier (ADR-0012). In the card-13 click UI it behaves like `comment`.
- `runAction(itemId, "request_changes", { body })` → Octokit `pulls.createReview({ owner, repo, pull_number, event: "REQUEST_CHANGES", body })`. A missing/empty body → return `{ ok:false, message:"request_changes needs a body" }` (GitHub rejects an empty REQUEST_CHANGES body).

## Stub
```ts
// actions.ts
export async function requestChanges(octokit, repo: string, prNumber: number, body: string): Promise<ActionResult> {
  if (!body?.trim()) return { ok: false, message: "request_changes needs a body" };
  const [owner, name] = repo.split("/");
  await octokit.pulls.createReview({ owner, repo: name, pull_number: prNumber, event: "REQUEST_CHANGES", body });
  return { ok: true, message: `Requested changes on #${prNumber}` };
}
```

## Steps
1. Add `requestChanges` to `actions.ts`; route it in `GithubAdapter.runAction`.
2. Add the action to the review-requested branch of `map.ts` (alongside approve/comment).
3. Extend tests.

## Acceptance check
```bash
bun test packages/adapter-github     # green (Octokit mocked)
```
Tests must prove:
- A review-requested Item's `actions` now includes `request_changes` (safe).
- `runAction(id, "request_changes", { body: "fix auth" })` calls `pulls.createReview` with `event:"REQUEST_CHANGES"` and that body.
- `runAction(id, "request_changes", { body: "" })` returns `{ ok:false }` and does **not** call Octokit.
- Existing approve/comment/merge/rerun tests still pass (no regression).

## Out of scope / do NOT do
- No new discovery queries, no new Items, no rung changes (ADR-0002/0006 unchanged).
- Do not add `request_changes` to author/CI Items — only where review is requested of you.
- Do not make it `dangerous` — the dictation read-back is the guard (ADR-0012); keep risk tiers honest.
- No GitHub App / webhooks (still poll-only, PAT from config).
