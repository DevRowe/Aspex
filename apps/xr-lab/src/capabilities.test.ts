import { describe, expect, test } from "bun:test";
import {
  NO_CAPABILITIES,
  classifyInputSource,
  focusRayEligible,
  interactionHint,
  summarizeCapabilities,
} from "./capabilities";

describe("input source classification", () => {
  test("articulated hands classify as hand regardless of target ray mode", () => {
    expect(
      classifyInputSource({ hand: {}, targetRayMode: "tracked-pointer" }),
    ).toBe("hand");
    expect(classifyInputSource({ hand: {} })).toBe("hand");
  });

  test("tracked pointers without a hand classify as controller", () => {
    expect(
      classifyInputSource({ gamepad: {}, targetRayMode: "tracked-pointer" }),
    ).toBe("controller");
    expect(classifyInputSource({ targetRayMode: "tracked-pointer" })).toBe(
      "controller",
    );
  });

  test("gaze, transient-pointer, and screen modes classify by ray mode", () => {
    expect(classifyInputSource({ targetRayMode: "gaze" })).toBe("gaze");
    expect(classifyInputSource({ targetRayMode: "transient-pointer" })).toBe(
      "transient-pointer",
    );
    expect(classifyInputSource({ targetRayMode: "screen" })).toBe("screen");
  });

  test("a gamepad with no ray mode still counts as a controller", () => {
    expect(classifyInputSource({ gamepad: {} })).toBe("controller");
  });

  test("a source with nothing recognizable is unknown", () => {
    expect(classifyInputSource({})).toBe("unknown");
    expect(classifyInputSource({ hand: null, gamepad: null })).toBe("unknown");
  });
});

describe("session capability summary", () => {
  test("no sources yields no capabilities", () => {
    expect(summarizeCapabilities([])).toEqual(NO_CAPABILITIES);
  });

  test("mixed hand and controller sources set both flags", () => {
    const summary = summarizeCapabilities([
      { hand: {}, targetRayMode: "tracked-pointer" },
      { gamepad: {}, targetRayMode: "tracked-pointer" },
    ]);
    expect(summary.hands).toBe(true);
    expect(summary.controllers).toBe(true);
    expect(summary.gaze).toBe(false);
  });

  test("gaze-only devices report only gaze", () => {
    expect(summarizeCapabilities([{ targetRayMode: "gaze" }])).toEqual({
      ...NO_CAPABILITIES,
      gaze: true,
    });
  });

  test("unknown sources contribute nothing", () => {
    expect(summarizeCapabilities([{}])).toEqual(NO_CAPABILITIES);
  });
});

describe("focus ray eligibility", () => {
  test("every classified source may drive the focus ray", () => {
    expect(focusRayEligible({ hand: {} })).toBe(true);
    expect(focusRayEligible({ targetRayMode: "tracked-pointer" })).toBe(true);
    expect(focusRayEligible({ targetRayMode: "gaze" })).toBe(true);
    expect(focusRayEligible({ targetRayMode: "screen" })).toBe(true);
    expect(focusRayEligible({ targetRayMode: "transient-pointer" })).toBe(true);
  });

  test("unclassified sources never drive the focus ray", () => {
    expect(focusRayEligible({})).toBe(false);
  });
});

describe("interaction hint", () => {
  test("voice + select is always announced first", () => {
    expect(interactionHint(NO_CAPABILITIES)).toStartWith(
      "Voice + select ready",
    );
    expect(interactionHint({ ...NO_CAPABILITIES, hands: true })).toStartWith(
      "Voice + select ready",
    );
  });

  test("hints match the inputs actually present", () => {
    expect(interactionHint({ ...NO_CAPABILITIES, hands: true })).toContain(
      "pinch selects",
    );
    expect(
      interactionHint({ ...NO_CAPABILITIES, controllers: true }),
    ).toContain("trigger selects");
    expect(interactionHint({ ...NO_CAPABILITIES, gaze: true })).toContain(
      "gaze + select",
    );
    expect(interactionHint({ ...NO_CAPABILITIES, screen: true })).toContain(
      "tap selects",
    );
    expect(
      interactionHint({ ...NO_CAPABILITIES, transientPointer: true }),
    ).toContain("tap selects");
  });

  test("with no pointing input the hint says so without dropping voice", () => {
    expect(interactionHint(NO_CAPABILITIES)).toContain(
      "no pointing input detected",
    );
  });

  test("multiple pointer capabilities are all listed", () => {
    const hint = interactionHint({
      ...NO_CAPABILITIES,
      hands: true,
      controllers: true,
    });
    expect(hint).toContain("pinch selects");
    expect(hint).toContain("trigger selects");
  });
});
