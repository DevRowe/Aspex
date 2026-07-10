import type { Action, ClientDirective } from "@aspex/schema";
import "./styles.css";
import { ConfirmationGate } from "./confirmation";
import { DirectionClient, type DirectionResult } from "./direction";
import type { ConnectionState } from "./domain";
import { HubClient } from "./hubClient";
import { FocusController } from "./input";
import type { LogicalAction, LogicalDispatch } from "./intentIds";
import { LabScene } from "./scene";
import { PairingSettings } from "./settings";
import { VoiceController, type VoiceState } from "./voice";
import { LabWorldModel } from "./worldModel";

type PendingOperation =
  | { kind: "action"; operation: LogicalAction }
  | { kind: "dispatch"; operation: LogicalDispatch };

const app = requiredElement<HTMLElement>("app");
app.insertAdjacentHTML(
  "beforeend",
  `<section class="hud" aria-label="Lab controls">
    <div class="hud-group">
      <span id="connection" class="connection" role="status" aria-live="polite">Not paired</span>
    </div>
    <div class="hud-group">
      <button id="dispatch-button" class="icon-button" type="button" title="Dispatch a task" aria-label="Dispatch a task">+</button>
      <button id="ar-button" class="compact-button" type="button" title="Enter immersive AR" aria-label="Enter immersive AR">AR</button>
      <button id="settings-button" class="icon-button" type="button" title="Pairing and diagnostics" aria-label="Pairing and diagnostics">⚙</button>
    </div>
  </section>
  <div class="sim-help" aria-hidden="true">Mouse = gaze · click = pinch · ←/→ = move · V hold = talk · Enter = select · Esc = cancel</div>
  <dialog id="settings-dialog" aria-labelledby="settings-title">
    <form id="settings-form" method="dialog">
      <h1 id="settings-title">Hub pairing</h1>
      <p>The token is sent only as a bearer header, except for the in-memory SSE URL required by EventSource. It is never displayed or logged.</p>
      <input name="username" type="text" autocomplete="username" value="aspex-hub" hidden />
      <label>Hub URL<input id="hub-url" name="hub-url" type="url" inputmode="url" required spellcheck="false" autocomplete="url" /></label>
      <label>Bearer token<input id="hub-token" name="hub-token" type="password" spellcheck="false" autocomplete="current-password" placeholder="Required for this browser tab" /></label>
      <div id="settings-error" class="error-text" role="alert"></div>
      <div id="diagnostics" class="diagnostics">No diagnostics yet.</div>
      <div class="dialog-actions">
        <button id="forget-token" class="compact-button" type="button">Forget token</button>
        <button class="compact-button" value="cancel" type="button" data-close>Cancel</button>
        <button class="compact-button primary" value="save" type="submit">Save & connect</button>
      </div>
    </form>
  </dialog>
  <dialog id="text-dialog" aria-labelledby="text-title">
    <form id="text-form" method="dialog">
      <h1 id="text-title">Direction</h1>
      <p id="text-help">Give Giles the concise direction to deliver.</p>
      <label id="project-label">Project (optional)<input id="project-input" name="project" spellcheck="false" /></label>
      <label>Direction<textarea id="direction-text" name="direction" required maxlength="1200"></textarea></label>
      <div id="text-error" class="error-text" role="alert"></div>
      <div class="dialog-actions">
        <button class="compact-button" type="button" data-close-text>Cancel</button>
        <button class="compact-button primary" type="submit">Continue</button>
      </div>
    </form>
  </dialog>`,
);

const settings = new PairingSettings();
const world = new LabWorldModel();
const confirmation = new ConfirmationGate<PendingOperation>();
const direction = new DirectionClient(() => requiredConfig());
let connection: ConnectionState = {
  phase: "unconfigured",
  detail: "Pair a Hub URL and token to begin.",
  attempt: 0,
};
let voiceState: VoiceState = {
  phase: "idle",
  message: "Hold to speak",
  canCancel: false,
};
let notice = "";
let arActive = false;
let retryDelivery: { pending: PendingOperation; confirmed: boolean } | null =
  null;

const voice = new VoiceController(
  () => requiredConfig(),
  () => ({ selectedId: world.selected()?.id, needsMeIds: world.needsMeIds() }),
  applyDirective,
);

const input = new FocusController({
  activate: (targetId) => {
    void activate(targetId).catch((error) => showNotice(errorMessage(error)));
  },
  pushToTalkStart: () => void voice.press(),
  pushToTalkEnd: () => void voice.release(),
  focusChanged: (targetId) => scene.setFocus(targetId),
});

const scene = new LabScene(app, input, (active) => {
  arActive = active;
  arButton.textContent = active ? "EXIT AR" : "AR";
});

const hub = new HubClient(() => settings.get(), {
  onState: (state) => {
    world.apply(state);
    render();
  },
  onConnection: (next) => {
    connection = next;
    render();
  },
  onMalformed: (message) => {
    notice = `Malformed event ignored: ${message}`;
    render();
  },
});

const connectionElement = requiredElement<HTMLElement>("connection");
const settingsDialog = requiredElement<HTMLDialogElement>("settings-dialog");
const settingsForm = requiredElement<HTMLFormElement>("settings-form");
const settingsButton = requiredElement<HTMLButtonElement>("settings-button");
const dispatchButton = requiredElement<HTMLButtonElement>("dispatch-button");
const arButton = requiredElement<HTMLButtonElement>("ar-button");
const hubUrlInput = requiredElement<HTMLInputElement>("hub-url");
const hubTokenInput = requiredElement<HTMLInputElement>("hub-token");
const settingsError = requiredElement<HTMLElement>("settings-error");
const diagnostics = requiredElement<HTMLElement>("diagnostics");
const textDialog = requiredElement<HTMLDialogElement>("text-dialog");
const textForm = requiredElement<HTMLFormElement>("text-form");
const textTitle = requiredElement<HTMLElement>("text-title");
const textHelp = requiredElement<HTMLElement>("text-help");
const projectLabel = requiredElement<HTMLElement>("project-label");
const projectInput = requiredElement<HTMLInputElement>("project-input");
const directionText = requiredElement<HTMLTextAreaElement>("direction-text");
const textError = requiredElement<HTMLElement>("text-error");
let textSubmit: ((text: string, project?: string) => void) | null = null;

settingsButton.addEventListener("click", () => void openSettings());
dispatchButton.addEventListener("click", () => openDispatch());
arButton.addEventListener(
  "click",
  () =>
    void (arActive
      ? scene.exitAr()
      : scene.enterAr().catch((error) => showNotice(errorMessage(error)))),
);
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const existing = settings.get();
    settings.save(
      hubUrlInput.value,
      hubTokenInput.value || existing?.token || "",
    );
    hubTokenInput.value = "";
    settingsError.textContent = "";
    settingsDialog.close();
    hub.start();
  } catch (error) {
    settingsError.textContent = errorMessage(error);
  }
});
requiredElement<HTMLButtonElement>("forget-token").addEventListener(
  "click",
  () => {
    settings.clearToken();
    hub.stop();
    connection = {
      phase: "unconfigured",
      detail: "Token forgotten. Pair again to connect.",
      attempt: 0,
    };
    hubTokenInput.value = "";
    render();
  },
);
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-close]",
)) {
  button.addEventListener("click", () => settingsDialog.close());
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-close-text]",
)) {
  button.addEventListener("click", () => {
    textSubmit = null;
    textDialog.close();
  });
}
textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = directionText.value.trim();
  if (text === "") {
    textError.textContent = "Direction text is required.";
    return;
  }
  textSubmit?.(text, projectInput.value.trim() || undefined);
  textSubmit = null;
  textDialog.close();
});

voice.subscribe((state) => {
  voiceState = state;
  notice = state.message;
  render();
});
world.subscribe(render);
confirmation.subscribe(render);
window.addEventListener("online", () => hub.start());
window.addEventListener("offline", () => {
  connection = {
    ...connection,
    phase: "offline",
    detail: "Browser reports no network; keeping last cards.",
  };
  render();
});
window.addEventListener("keydown", (event) => {
  if (isTextInput(event.target)) {
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    world.move(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    world.move(1);
  } else if (event.key === "Enter") {
    input.select();
  } else if (event.code === "KeyV" && !event.repeat) {
    event.preventDefault();
    void voice.press();
  } else if (event.key === "Escape") {
    confirmation.cancel();
    void voice.cancel();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "KeyV" && !isTextInput(event.target)) {
    event.preventDefault();
    void voice.release();
  }
});
window.addEventListener("blur", () => {
  input.cancelHold();
  void voice.release();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    input.cancelHold();
    void voice.release();
  }
});
setInterval(() => confirmation.tick(), 250);

void scene.supportsAr().then((supported) => {
  arButton.disabled = !supported;
  arButton.title = supported
    ? "Enter immersive AR"
    : "WebXR immersive AR is unavailable; simulator remains fully usable";
});

if (settings.get() === null) {
  void openSettings();
} else {
  hub.start();
}
render();

async function activate(targetId: string): Promise<void> {
  if (targetId === "nav:previous") {
    world.move(-1);
    return;
  }
  if (targetId === "nav:next") {
    world.move(1);
    return;
  }
  if (targetId === "control:settings") {
    await openSettings();
    return;
  }
  if (targetId === "control:status") {
    showDirectionResult(
      await direction.statusQuery(world.selected()?.id ?? "needs_me"),
    );
    return;
  }
  if (targetId === "control:retry") {
    if (retryDelivery !== null) {
      await deliver(retryDelivery.pending, retryDelivery.confirmed);
    }
    return;
  }
  if (targetId === "control:voice-cancel") {
    await voice.cancel();
    return;
  }
  if (targetId === "confirm:cancel") {
    confirmation.cancel();
    showNotice("Cancelled. Nothing was delivered.");
    return;
  }
  if (targetId === "confirm:yes") {
    const pending = confirmation.takeConfirmed();
    if (pending !== null) {
      await deliver(pending, true);
    }
    return;
  }
  if (targetId.startsWith("action:")) {
    const item = world.selected();
    const actionId = targetId.slice("action:".length);
    const action = item?.actions.find((candidate) => candidate.id === actionId);
    if (item === undefined || action === undefined) {
      showNotice("That action is no longer available.");
      return;
    }
    if (needsText(action)) {
      openActionText(
        action,
        (text) =>
          void attemptAction(
            action,
            direction.beginAction(item.id, action.id, { text }),
          ),
      );
    } else {
      await attemptAction(action, direction.beginAction(item.id, action.id));
    }
  }
}

async function attemptAction(
  action: Action,
  operation: LogicalAction,
): Promise<void> {
  retryDelivery = null;
  if (action.id === "ship") {
    confirmation.arm({ kind: "action", operation }, action.label);
    showNotice("Review & ship armed. Pinch CONFIRM to give the merge word.");
    return;
  }
  const result = await direction.action(operation, false);
  if (result.kind === "confirmation_required") {
    confirmation.arm({ kind: "action", operation }, action.label);
    showNotice(`${action.label} armed. Explicit second confirmation required.`);
    return;
  }
  handleDeliveryResult(result, { kind: "action", operation }, false);
}

function openDispatch(): void {
  openTextDialog(
    "Dispatch new task",
    "This is consequential. The Hub will arm it, then require an explicit second confirm.",
    true,
    (text, project) => {
      const operation = direction.beginDispatch(text, project);
      retryDelivery = null;
      void direction.dispatch(operation, false).then((result) => {
        if (result.kind === "confirmation_required") {
          confirmation.arm(
            { kind: "dispatch", operation },
            "Dispatch new task",
          );
          showNotice("Dispatch armed. Explicit second confirmation required.");
        } else {
          handleDeliveryResult(result, { kind: "dispatch", operation }, false);
        }
      });
    },
  );
}

function openActionText(
  action: Action,
  callback: (text: string) => void,
): void {
  openTextDialog(
    action.label,
    "This text is delivered to Giles through the selected item's real Hub action.",
    false,
    (text) => callback(text),
  );
}

function openTextDialog(
  title: string,
  help: string,
  showProject: boolean,
  callback: (text: string, project?: string) => void,
): void {
  textTitle.textContent = title;
  textHelp.textContent = help;
  projectLabel.hidden = !showProject;
  projectInput.value = "";
  directionText.value = "";
  textError.textContent = "";
  textSubmit = callback;
  textDialog.showModal();
  directionText.focus();
}

async function openSettings(): Promise<void> {
  if (arActive) {
    await scene.exitAr();
  }
  const cfg = settings.get();
  hubUrlInput.value = cfg?.hubUrl ?? "http://127.0.0.1:4317";
  hubTokenInput.value = "";
  hubTokenInput.placeholder =
    cfg === null ? "Paste the Hub token" : "Token stored for this browser tab";
  settingsError.textContent = "";
  diagnostics.textContent = `${connection.phase.replaceAll("_", " ")} · ${connection.detail}${connection.lastStateAt ? ` · last state ${new Date(connection.lastStateAt).toLocaleTimeString()}` : ""}`;
  if (!settingsDialog.open) {
    settingsDialog.showModal();
  }
}

function applyDirective(directive: ClientDirective): void {
  switch (directive.type) {
    case "select":
      world.select(directive.id);
      break;
    case "move":
      world.move(directive.delta);
      break;
    case "show_needs_me":
      if (world.snapshot()?.needsMe[0] !== undefined) {
        world.select(world.snapshot()?.needsMe[0]?.id ?? "");
      }
      break;
    case "open": {
      const item = world
        .orderedItems()
        .find((candidate) => candidate.id === directive.id);
      if (item?.deepLink !== undefined) {
        window.open(item.deepLink, "_blank", "noopener,noreferrer");
      }
      break;
    }
    case "none":
      break;
  }
}

function showDirectionResult(result: DirectionResult): void {
  if (result.kind === "failed") {
    showNotice(
      `${result.message}${result.retryable ? " Retry is safe and keeps the same intent id." : ""}`,
    );
  } else {
    showNotice(result.message);
  }
}

async function deliver(
  pending: PendingOperation,
  confirmed: boolean,
): Promise<void> {
  const result =
    pending.kind === "action"
      ? await direction.action(pending.operation, confirmed)
      : await direction.dispatch(pending.operation, confirmed);
  if (result.kind === "confirmation_required") {
    retryDelivery = null;
    confirmation.arm(
      pending,
      pending.kind === "action"
        ? pending.operation.actionId
        : "Dispatch new task",
    );
    showNotice("Explicit second confirmation required.");
    return;
  }
  handleDeliveryResult(result, pending, confirmed);
}

function handleDeliveryResult(
  result: DirectionResult,
  pending: PendingOperation,
  confirmed: boolean,
): void {
  retryDelivery =
    result.kind === "failed" && result.retryable
      ? { pending, confirmed }
      : null;
  showDirectionResult(result);
}

function showNotice(message: string): void {
  notice = message;
  render();
}

function render(): void {
  const snapshot = world.snapshot();
  const items = world.orderedItems();
  const item = world.selected();
  connectionElement.dataset.phase = connection.phase;
  connectionElement.textContent = `${connection.phase.replaceAll("_", " ")} · ${connection.detail}`;
  scene.setView({
    ...(item === undefined ? {} : { item }),
    index: world.selectedIndex(),
    total: items.length,
    overflow: snapshot?.overflow.length ?? 0,
    connection,
    voice: voiceState,
    armed: confirmation.current(),
    retryAvailable: retryDelivery !== null,
    notice,
  });
}

function requiredConfig() {
  const cfg = settings.get();
  if (cfg === null) {
    throw new Error("Hub is not paired.");
  }
  return cfg;
}

function needsText(action: Action): boolean {
  return (
    action.id === "answer" || action.id === "redirect" || action.id === "deny"
  );
}

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id}`);
  }
  return element as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}
