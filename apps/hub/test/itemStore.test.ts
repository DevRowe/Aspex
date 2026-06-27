import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AttentionItem } from "@aspex/schema";
import { openDb } from "../src/store/db";
import { ItemStore } from "../src/store/itemStore";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "github:pr:owner/repo#42",
    source: "github",
    project: "owner/repo",
    state: "needs_review",
    liveness: "live",
    reason: "review_requested",
    attentionRequired: true,
    severity: "medium",
    summary: "Review requested on owner/repo#42",
    evidence: [{ label: "Pull request", url: "https://example.test/pr/42" }],
    actions: [
      {
        id: "view",
        label: "View PR",
        risk: "safe",
        requiresConfirmation: false,
      },
    ],
    deepLink: "https://example.test/pr/42",
    observedAt: "2026-06-28T00:00:00.000Z",
    staleAfter: "2026-06-28T00:05:00.000Z",
    ...overrides,
  };
}

function openMemoryStore(): {
  db: ReturnType<typeof openDb>;
  store: ItemStore;
} {
  const db = openDb(":memory:");
  return { db, store: new ItemStore(db) };
}

describe("ItemStore", () => {
  test("upserting the same id replaces the row and leaves one item", () => {
    const { db, store } = openMemoryStore();
    const first = makeItem({
      summary: "first",
      observedAt: "2026-06-28T00:00:00.000Z",
    });
    const second = makeItem({
      summary: "second",
      severity: "high",
      observedAt: "2026-06-28T00:01:00.000Z",
    });

    store.upsert(first);
    store.upsert(second);

    expect(store.get(first.id)).toEqual(second);
    expect(store.getAll()).toEqual([second]);
    expect(
      db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM items")
        .get()?.count,
    ).toBe(1);

    db.close();
  });

  test("getAll returns parsed AttentionItem objects", () => {
    const { db, store } = openMemoryStore();
    const githubItem = makeItem({ id: "github:pr:owner/repo#42" });
    const codexItem = makeItem({
      id: "codex:session:abc",
      source: "codex",
      project: "aspex",
      state: "blocked",
      reason: "blocked_on_human",
      summary: "Codex is blocked",
    });

    store.upsert(codexItem);
    store.upsert(githubItem);

    expect(store.getAll()).toEqual([codexItem, githubItem]);

    db.close();
  });

  test("file-backed store survives close and reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "aspex-item-store-"));
    tempDirs.push(dir);
    const path = join(dir, "hub.sqlite");
    const item = makeItem({
      id: "claude-code:session:abc",
      source: "claude-code",
    });

    const firstDb = openDb(path);
    new ItemStore(firstDb).upsert(item);
    firstDb.close();

    const secondDb = openDb(path);
    const reopenedStore = new ItemStore(secondDb);

    expect(reopenedStore.get(item.id)).toEqual(item);
    expect(reopenedStore.getAll()).toEqual([item]);

    secondDb.close();
  });
});
