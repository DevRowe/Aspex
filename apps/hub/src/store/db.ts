import { Database } from "bun:sqlite";

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      source TEXT NOT NULL,
      attention_required INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      stale_after TEXT NOT NULL
    );
  `);
}
