import { describe, expect, test } from "bun:test";
import { FocusController } from "./input";

describe("FocusController", () => {
  test("maps target-ray focus and select to one stable action activation", () => {
    const activated: string[] = [];
    const controller = new FocusController({
      activate: (id) => activated.push(id),
      pushToTalkStart: () => undefined,
      pushToTalkEnd: () => undefined,
    });
    controller.focus("action:approve");
    controller.selectStart();
    controller.select();
    controller.selectEnd();
    expect(activated).toEqual(["action:approve"]);
  });

  test("maps gaze or articulated selectstart/selectend to press-only microphone capture", () => {
    const phases: string[] = [];
    const controller = new FocusController({
      activate: () => undefined,
      pushToTalkStart: () => phases.push("start"),
      pushToTalkEnd: () => phases.push("end"),
    });
    controller.focus("control:ptt");
    controller.selectStart();
    controller.select();
    controller.selectEnd();
    expect(phases).toEqual(["start", "end"]);
  });
});
