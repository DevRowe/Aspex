# Card 03 — Hub: SQLite Item store

## Goal
A persistence layer for Items using `bun:sqlite` (ADR-0005: SQLite is authoritative). Supports **upsert-by-id** (ADR-0001), read-all, read-one, delete, and survives restart. This is the only module that touches the database.

## Depends on
- Card 01, Card 02.

## Files to create
```
apps/hub/src/store/db.ts          # open db, run migrations
apps/hub/src/store/itemStore.ts   # upsert / getAll / get / remove
apps/hub/test/itemStore.test.ts
```

## Interfaces / stubs

**`db.ts`**:
```ts
import { Database } from "bun:sqlite";

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,          -- the full AttentionItem as JSON
    source TEXT NOT NULL,
    attention_required INTEGER NOT NULL,   -- 0/1, for fast needs-me queries
    observed_at TEXT NOT NULL,
    stale_after TEXT NOT NULL
  );`);
}
```
> Store the whole `AttentionItem` as a JSON column, plus a few promoted columns for querying. This keeps schema migrations rare while staying queryable.

**`itemStore.ts`**:
```ts
import type { Database } from "bun:sqlite";
import type { AttentionItem } from "@aspex/schema";

export class ItemStore {
  constructor(private db: Database) {}

  upsert(item: AttentionItem): void {
    // INSERT ... ON CONFLICT(id) DO UPDATE SET ... — replace by id (ADR-0001)
  }
  get(id: string): AttentionItem | null { /* parse json */ }
  getAll(): AttentionItem[] { /* parse all rows */ }
  remove(id: string): void {}
}
```

## Steps
1. `bun add` nothing — `bun:sqlite` is built in.
2. Implement `openDb` + `migrate`.
3. Implement `ItemStore` with a prepared `INSERT ... ON CONFLICT(id) DO UPDATE`.
4. JSON-serialize on write, parse on read. Promote `source`, `attention_required`, `observed_at`, `stale_after` into columns from the item.
5. Write tests using an in-memory db (`new Database(":memory:")`).

## Acceptance check
```bash
bun test apps/hub/test/itemStore.test.ts   # green
```
Tests must prove:
- Upserting the **same id twice** leaves **one** row, with the second value winning (the core ADR-0001 guarantee).
- `getAll()` returns parsed `AttentionItem` objects.
- A store opened on a file path, written to, closed, and re-opened still has the rows (restart survival).

## Out of scope / do NOT do
- No ranking, liveness decay, HTTP, or adapters here — pure storage.
- Do **not** use an ORM (Prisma/Drizzle) or any native sqlite addon — `bun:sqlite` only (Bun-compile-safe, ADR-0008).
- Do not store Signals as history; this table holds **current Items only** (ADR-0001 rejected the event log).
