import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext, Signal } from "@aspex/schema";
import { GilesOrchestrator } from "../src";

const BACKLOG = `# Backlog

## In flight
- [ ] numbat-tracing-g3 - Letter-tracing activity (repo: numbat) (kind: ship) (since 2026-07-09)
- [ ] numbat-pack-batch-p3 - Numbat pack batch curation (repo: numbat-pipeline) (kind: ship) (since 2026-07-08)

## Done
`;

const WORKER_STATES: Record<string, string> = {
  "numbat-tracing-g3":
    "state: done · source: run-step · checks green, awaiting merge",
  "numbat-pack-batch-p3": "state: parked · source: run-step · parked for owner",
};

let home: string;
let orchestrator: GilesOrchestrator;
let emitted: Signal[];
let ctx: AdapterContext;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "aspex-giles-home-"));
  await mkdir(join(home, "data"), { recursive: true });
  await mkdir(join(home, "state"), { recursive: true });
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(join(home, "data/backlog.md"), BACKLOG);
  await writeFile(join(home, "bin/giles-worker-state.sh"), "#!/bin/sh\n");
  await writeFile(
    join(home, "state/numbat-tracing-g3.meta"),
    "project=/home/rowe/giles/projects/numbat\nkind=ship\nharness=claude\npr=https://github.com/DevRowe/numbat/pull/12\n",
  );
  await writeFile(
    join(home, "state/numbat-pack-batch-p3.meta"),
    "project=/home/rowe/giles/projects/numbat-pipeline\nkind=ship\nharness=claude\n",
  );
  await writeFile(
    join(home, "state/numbat-pack-batch-p3.status"),
    "working: generating\nneeds-decision: owner must pick one keeper per asset ID\n",
  );

  emitted = [];
  ctx = {
    emit: (signal) => emitted.push(signal),
    heartbeat: () => {},
    log: () => {},
  };
  orchestrator = new GilesOrchestrator({
    home,
    exec: async (argv) => {
      const taskId = argv[1] ?? "";
      const line = WORKER_STATES[taskId];

      return line === undefined
        ? { exitCode: 1, stdout: "" }
        : { exitCode: 0, stdout: `${line}\n` };
    },
    now: () => new Date("2026-07-10T09:21:04Z"),
  });
});

afterEach(async () => {
  await orchestrator.stop();
  await rm(home, { recursive: true, force: true });
});

describe("state IN: poll", () => {
  test("emits one Signal per in-flight task, mapped through the lifecycle table", async () => {
    const signals = await orchestrator.poll(ctx);

    expect(signals).toHaveLength(2);
    expect(emitted.map((s) => s.id)).toEqual([
      "orchestrator:giles:numbat-tracing-g3",
      "orchestrator:giles:numbat-pack-batch-p3",
    ]);
    expect(emitted[0]).toMatchObject({
      state: "needs_review",
      reason: "awaiting_merge",
      deepLink: "https://github.com/DevRowe/numbat/pull/12",
    });
    expect(emitted[1]).toMatchObject({
      state: "blocked",
      reason: "blocked_on_human",
      severity: "high",
    });
  });

  test("caches per-item actions for listActions", async () => {
    await orchestrator.poll(ctx);

    expect(
      orchestrator
        .listActions("orchestrator:giles:numbat-tracing-g3")
        .map((a) => a.id),
    ).toEqual(["ship", "deny", "redirect"]);
    expect(orchestrator.listActions("orchestrator:giles:nope")).toEqual([]);
  });

  test("a task that leaves In flight emits one terminal done and decays", async () => {
    await orchestrator.poll(ctx);
    await writeFile(
      join(home, "data/backlog.md"),
      "# Backlog\n\n## In flight\n- [ ] numbat-tracing-g3 - Letter-tracing activity (repo: numbat) (kind: ship)\n",
    );

    emitted = [];
    await orchestrator.poll(ctx);

    const departed = emitted.find(
      (s) => s.id === "orchestrator:giles:numbat-pack-batch-p3",
    );
    expect(departed).toMatchObject({ state: "done", reason: "ambient" });

    emitted = [];
    await orchestrator.poll(ctx);
    expect(
      emitted.some((s) => s.id === "orchestrator:giles:numbat-pack-batch-p3"),
    ).toBe(false);
  });

  test("a backlog without the In flight section skips the departure sweep", async () => {
    await orchestrator.poll(ctx);
    await rm(join(home, "data/backlog.md"));

    emitted = [];
    await orchestrator.poll(ctx);
    expect(emitted).toEqual([]);

    await writeFile(join(home, "data/backlog.md"), "# Backlog\n\n## Done\n");
    await orchestrator.poll(ctx);
    expect(emitted).toEqual([]);

    await writeFile(join(home, "data/backlog.md"), BACKLOG);
    await orchestrator.poll(ctx);
    expect(emitted.map((s) => s.state)).toEqual(["needs_review", "blocked"]);
  });

  test("poll never writes into the giles home", async () => {
    const before = await readdir(join(home, "state"));
    await orchestrator.poll(ctx);
    const after = await readdir(join(home, "state"));

    expect(after).toEqual(before);
    expect(existsSync(join(home, "state/aspex-inbox"))).toBe(false);
  });
});

describe("direction OUT: inbox writes", () => {
  test("runAction writes the design's item-scoped intent file shape", async () => {
    await orchestrator.poll(ctx);

    const result = await orchestrator.runAction(
      "orchestrator:giles:numbat-pack-batch-p3",
      "answer",
      {
        intentId: "b1e6-answer-07",
        text: "Use candidate 3 where identity is ambiguous.",
      },
    );

    expect(result.ok).toBe(true);
    const raw = await readFile(
      join(home, "state/aspex-inbox/b1e6-answer-07.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      intentId: "b1e6-answer-07",
      verb: "answer",
      targetTaskId: "numbat-pack-batch-p3",
      text: "Use candidate 3 where identity is ambiguous.",
      confirmedAt: "2026-07-10T09:21:04.000Z",
      origin: "aspex-hub",
    });
  });

  test("a retried intentId is not written twice", async () => {
    const run = () =>
      orchestrator.runAction("orchestrator:giles:numbat-tracing-g3", "ship", {
        intentId: "b1e6-ship-01",
        text: "looks good, ship it",
        mergeWord: "ship",
      });

    const first = await run();
    const raw = await readFile(
      join(home, "state/aspex-inbox/b1e6-ship-01.json"),
      "utf8",
    );
    const second = await run();
    const rawAfterRetry = await readFile(
      join(home, "state/aspex-inbox/b1e6-ship-01.json"),
      "utf8",
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.message).toContain("Already queued");
    expect(rawAfterRetry).toBe(raw);
    expect(await readdir(join(home, "state/aspex-inbox"))).toEqual([
      "b1e6-ship-01.json",
    ]);
  });

  test("refuses ship without an explicit merge word", async () => {
    await orchestrator.poll(ctx);

    const result = await orchestrator.runAction(
      "orchestrator:giles:numbat-tracing-g3",
      "ship",
      { intentId: "b1e6-ship-02" },
    );

    expect(result).toEqual({
      ok: false,
      message: "Ship requires merge or ship confirmation",
    });
    expect(existsSync(join(home, "state/aspex-inbox"))).toBe(false);
  });

  test("rejects intentIds that are not filename-safe", async () => {
    const result = await orchestrator.runAction(
      "orchestrator:giles:numbat-tracing-g3",
      "redirect",
      { intentId: "../../escape", text: "nope" },
    );

    expect(result.ok).toBe(false);
    expect(existsSync(join(home, "state/aspex-inbox"))).toBe(false);
  });

  test("rejects items owned by another orchestrator and unknown verbs", async () => {
    expect(
      (await orchestrator.runAction("orchestrator:other:task-1", "answer")).ok,
    ).toBe(false);
    expect(
      (
        await orchestrator.runAction(
          "orchestrator:giles:numbat-tracing-g3",
          "merge",
        )
      ).ok,
    ).toBe(false);
  });

  test("dispatch writes the design's referent-less intent file shape", async () => {
    const ack = await orchestrator.dispatch({
      verb: "dispatch",
      intentId: "b1e6-dispatch-11",
      orchestrator: "giles",
      project: "numbat",
      instruction:
        "Add a settings screen to toggle background music, persisted locally.",
      confirmed: true,
    });

    expect(ack.ok).toBe(true);
    const raw = await readFile(
      join(home, "state/aspex-inbox/b1e6-dispatch-11.json"),
      "utf8",
    );
    expect(JSON.parse(raw)).toEqual({
      intentId: "b1e6-dispatch-11",
      verb: "dispatch",
      targetTaskId: null,
      project: "numbat",
      instruction:
        "Add a settings screen to toggle background music, persisted locally.",
      confirmedAt: "2026-07-10T09:21:04.000Z",
      origin: "aspex-hub",
    });
  });
});

describe("status action and query", () => {
  test("the status action reads the authoritative helper, no inbox write", async () => {
    const result = await orchestrator.runAction(
      "orchestrator:giles:numbat-tracing-g3",
      "status",
    );

    expect(result.ok).toBe(true);
    expect(result.message).toBe(
      "numbat-tracing-g3: done - checks green, awaiting merge",
    );
    expect(existsSync(join(home, "state/aspex-inbox"))).toBe(false);
  });

  test("query with an item scope reads one task", async () => {
    const report = await orchestrator.query({
      verb: "status_query",
      intentId: "q-1",
      scope: "orchestrator:giles:numbat-pack-batch-p3",
    });

    expect(report).toEqual({
      ok: true,
      text: "numbat-pack-batch-p3: parked - parked for owner",
    });
  });

  test("query with needs_me lists the in-flight tasks", async () => {
    const report = await orchestrator.query({
      verb: "status_query",
      intentId: "q-2",
      scope: "needs_me",
    });

    expect(report.ok).toBe(true);
    expect(report.text).toContain("2 in flight");
    expect(report.text).toContain("numbat-tracing-g3");
  });
});
