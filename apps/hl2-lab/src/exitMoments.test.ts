import { describe, expect, test } from "bun:test";
import { ConfirmationGate } from "./confirmation";
import { DirectionClient } from "./direction";
import type { LogicalAction, LogicalDispatch } from "./intentIds";
import { item, ranked } from "./testFixtures";
import { LabWorldModel } from "./worldModel";

type Pending =
  | { kind: "action"; operation: LogicalAction }
  | { kind: "dispatch"; operation: LogicalDispatch };

describe("the three HL2 lab exit moments with a non-writing Hub double", () => {
  test("1: blocked item approve arms on 409 and delivers only after the second confirm", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = doubleClient(bodies);
    const gate = new ConfirmationGate<Pending>();
    const operation = client.beginAction(
      "orchestrator:giles:blocked",
      "approve",
    );

    const first = await client.action(operation, false);
    expect(first.kind).toBe("confirmation_required");
    gate.arm({ kind: "action", operation }, "Approve");
    const confirmed = gate.takeConfirmed();
    expect(confirmed?.kind).toBe("action");
    if (confirmed?.kind === "action") {
      await client.action(confirmed.operation, true);
    }

    expect(bodies.map((body) => body.confirmed)).toEqual([false, true]);
    expect(bodies[0]?.intentId).toBe(bodies[1]?.intentId);
  });

  test("2: dispatch arms, confirms, then its resulting streamed item enters the carousel", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = doubleClient(bodies);
    const gate = new ConfirmationGate<Pending>();
    const operation = client.beginDispatch(
      "Add the exact wear-test checklist",
      "Aspex",
    );
    const first = await client.dispatch(operation, false);
    expect(first.kind).toBe("confirmation_required");
    gate.arm({ kind: "dispatch", operation }, "Dispatch");
    const confirmed = gate.takeConfirmed();
    if (confirmed?.kind === "dispatch") {
      await client.dispatch(confirmed.operation, true);
    }

    const world = new LabWorldModel();
    const resulting = item({
      id: "orchestrator:giles:wear-test-new",
      state: "working",
      reason: "ambient",
      attentionRequired: false,
      summary: "Exact wear-test checklist is now in progress.",
    });
    world.apply(ranked({ needsMe: [], ambient: [resulting] }));
    expect(
      world.orderedItems().some((entry) => entry.id === resulting.id),
    ).toBe(true);
    expect(bodies[0]?.intentId).toBe(bodies[1]?.intentId);
  });

  test("3: review-and-ship never sends a first-pinch request and one explicit confirm carries the merge word", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = doubleClient(bodies);
    const gate = new ConfirmationGate<Pending>();
    const operation = client.beginAction("orchestrator:giles:pr-ready", "ship");

    gate.arm({ kind: "action", operation }, "Review & ship");
    expect(bodies).toHaveLength(0);
    const confirmed = gate.takeConfirmed();
    if (confirmed?.kind === "action") {
      await client.action(confirmed.operation, true);
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.confirmed).toBe(true);
  });
});

function doubleClient(bodies: Array<Record<string, unknown>>): DirectionClient {
  return new DirectionClient(
    () => ({ hubUrl: "https://dry-run-hub.test", token: "test-token" }),
    (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body.confirmed !== true) {
        return Response.json(
          { message: "Action requires confirmation" },
          { status: 409 },
        );
      }
      return Response.json(
        { ok: true, message: "dry-run queued" },
        { status: 202 },
      );
    }) as typeof fetch,
  );
}
