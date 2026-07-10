import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isValidIntentId } from "@aspex/schema";

// The one place the adapter is allowed to WRITE inside the Giles home: the
// designated delivery inbox `state/aspex-inbox/`, one intent per file, named
// by intentId so a Hub-side retry can never produce a second file (the
// durable half of end-to-end idempotency). Giles drains it through an
// additive check-shim + `aspex-respond` skill built against the same design
// (aspex-protocol-design-d1 section 3.4).

export const INBOX_DIR = "state/aspex-inbox";

export interface GilesInboxIntent {
  intentId: string;
  verb: "approve" | "deny" | "answer" | "redirect" | "ship" | "dispatch";
  // <taskId> segment for item-scoped verbs; null for dispatch.
  targetTaskId: string | null;
  // Dictated body of answer/redirect/deny.
  text?: string;
  // Dispatch only.
  project?: string;
  instruction?: string;
  confirmedAt: string;
  origin: "aspex-hub";
}

export interface InboxWriteResult {
  path: string;
  // False when a file with this intentId already existed (a retry).
  written: boolean;
}

export async function writeIntentFile(
  gilesHome: string,
  intent: GilesInboxIntent,
): Promise<InboxWriteResult> {
  if (!isValidIntentId(intent.intentId)) {
    throw new Error("Invalid intentId");
  }

  const inboxDir = join(gilesHome, INBOX_DIR);
  const path = join(inboxDir, `${intent.intentId}.json`);

  if (existsSync(path)) {
    return { path, written: false };
  }

  await mkdir(inboxDir, { recursive: true });

  // Write-then-rename so the Giles-side drain never reads a partial file;
  // `wx` on the temp file so two concurrent writers cannot interleave.
  const tempPath = join(inboxDir, `.${intent.intentId}.${process.pid}.tmp`);

  try {
    await writeFile(tempPath, `${JSON.stringify(intent, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  return { path, written: true };
}
