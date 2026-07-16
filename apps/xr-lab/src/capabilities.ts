/**
 * Device-neutral input capability detection for the WebXR lab client.
 *
 * The lab assumes nothing about the device it runs on. At session start (and
 * on every input-source change) the connected `XRInputSource`s are classified
 * into capability kinds, and the interaction surface adapts to whatever is
 * actually present. Voice + a discrete select is the primary interaction
 * grammar on every device; pointing input only refines which target the
 * select lands on.
 */

export type InputKind =
  | "hand"
  | "controller"
  | "gaze"
  | "transient-pointer"
  | "screen"
  | "unknown";

/**
 * The structural subset of `XRInputSource` the classifier needs, so pure
 * tests can exercise it without a WebXR runtime.
 */
export interface InputSourceLike {
  readonly hand?: unknown;
  readonly gamepad?: unknown;
  readonly targetRayMode?: string;
}

export interface SessionCapabilities {
  hands: boolean;
  controllers: boolean;
  gaze: boolean;
  transientPointer: boolean;
  screen: boolean;
}

export const NO_CAPABILITIES: SessionCapabilities = Object.freeze({
  hands: false,
  controllers: false,
  gaze: false,
  transientPointer: false,
  screen: false,
});

export function classifyInputSource(source: InputSourceLike): InputKind {
  if (source.hand !== undefined && source.hand !== null) {
    return "hand";
  }
  switch (source.targetRayMode) {
    case "gaze":
      return "gaze";
    case "transient-pointer":
      return "transient-pointer";
    case "screen":
      return "screen";
    case "tracked-pointer":
      return "controller";
    default:
      return source.gamepad !== undefined && source.gamepad !== null
        ? "controller"
        : "unknown";
  }
}

export function summarizeCapabilities(
  sources: readonly InputSourceLike[],
): SessionCapabilities {
  const summary: SessionCapabilities = { ...NO_CAPABILITIES };
  for (const source of sources) {
    switch (classifyInputSource(source)) {
      case "hand":
        summary.hands = true;
        break;
      case "controller":
        summary.controllers = true;
        break;
      case "gaze":
        summary.gaze = true;
        break;
      case "transient-pointer":
        summary.transientPointer = true;
        break;
      case "screen":
        summary.screen = true;
        break;
      case "unknown":
        break;
    }
  }
  return summary;
}

/**
 * Whether an input source may drive the focus ray. Every classified source
 * carries a usable target ray (hands and controllers point, gaze rides the
 * head pose, transient-pointer and screen rays exist while pressed); only
 * sources the classifier cannot identify are excluded, since an unknown
 * slot at the identity transform would raycast from the origin and pin
 * focus, exactly the failure the controller-connected gating fixed.
 */
export function focusRayEligible(source: InputSourceLike): boolean {
  return classifyInputSource(source) !== "unknown";
}

/**
 * One line describing how to select with the inputs actually present.
 * Voice + discrete select is always available and always listed first.
 */
export function interactionHint(capabilities: SessionCapabilities): string {
  const pointers: string[] = [];
  if (capabilities.hands) {
    pointers.push("pinch selects");
  }
  if (capabilities.controllers) {
    pointers.push("trigger selects");
  }
  if (capabilities.gaze) {
    pointers.push("gaze + select");
  }
  if (capabilities.transientPointer || capabilities.screen) {
    pointers.push("tap selects");
  }
  if (pointers.length === 0) {
    return "Voice + select ready · no pointing input detected yet";
  }
  return `Voice + select ready · ${pointers.join(" · ")}`;
}
