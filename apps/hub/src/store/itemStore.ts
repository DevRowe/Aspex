import type { Database } from "bun:sqlite";
import type { AttentionItem } from "@aspex/schema";

interface ItemRow {
  json: string;
}

export class ItemStore {
  constructor(private db: Database) {}

  upsert(item: AttentionItem): void {
    this.db
      .query(`
        INSERT INTO items (
          id,
          json,
          source,
          attention_required,
          observed_at,
          stale_after
        )
        VALUES ($id, $json, $source, $attentionRequired, $observedAt, $staleAfter)
        ON CONFLICT(id) DO UPDATE SET
          json = excluded.json,
          source = excluded.source,
          attention_required = excluded.attention_required,
          observed_at = excluded.observed_at,
          stale_after = excluded.stale_after;
      `)
      .run({
        $id: item.id,
        $json: JSON.stringify(item),
        $source: item.source,
        $attentionRequired: item.attentionRequired ? 1 : 0,
        $observedAt: item.observedAt,
        $staleAfter: item.staleAfter,
      });
  }

  get(id: string): AttentionItem | null {
    const row = this.db
      .query<ItemRow, [string]>("SELECT json FROM items WHERE id = ?")
      .get(id);

    return row ? JSON.parse(row.json) : null;
  }

  getAll(): AttentionItem[] {
    return this.db
      .query<ItemRow, []>("SELECT json FROM items ORDER BY id")
      .all()
      .map((row) => JSON.parse(row.json));
  }

  remove(id: string): void {
    this.db.query("DELETE FROM items WHERE id = ?").run(id);
  }
}
