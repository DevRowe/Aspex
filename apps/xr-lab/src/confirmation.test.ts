import { describe, expect, test } from "bun:test";
import { ConfirmationGate } from "./confirmation";

describe("ConfirmationGate", () => {
  test("delivers an armed operation only after explicit confirm", () => {
    let now = 100;
    const gate = new ConfirmationGate<string>(1_000, () => now);
    gate.arm("ship-1", "Review & ship");
    expect(gate.takeConfirmed()).toBe("ship-1");
    expect(gate.takeConfirmed()).toBeNull();
    now += 1;
  });

  test("cancel and timeout clear the arm and deliver nothing", () => {
    let now = 100;
    const gate = new ConfirmationGate<string>(1_000, () => now);
    gate.arm("redirect-1", "Redirect");
    gate.cancel();
    expect(gate.takeConfirmed()).toBeNull();
    gate.arm("ship-1", "Review & ship");
    now = 1_100;
    gate.tick();
    expect(gate.takeConfirmed()).toBeNull();
  });
});
