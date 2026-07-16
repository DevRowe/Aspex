export interface FocusCallbacks {
  activate(targetId: string): void;
  pushToTalkStart(): void;
  pushToTalkEnd(): void;
  focusChanged?(targetId: string | null): void;
}

export class FocusController {
  private focused: string | null = null;
  private pttHeld = false;

  constructor(private callbacks: FocusCallbacks) {}

  focus(targetId: string | null): void {
    if (this.focused !== targetId) {
      this.focused = targetId;
      this.callbacks.focusChanged?.(targetId);
    }
  }

  current(): string | null {
    return this.focused;
  }

  selectStart(): void {
    if (this.focused === "control:ptt" && !this.pttHeld) {
      this.pttHeld = true;
      this.callbacks.pushToTalkStart();
    }
  }

  select(): void {
    if (this.focused !== null && this.focused !== "control:ptt") {
      this.callbacks.activate(this.focused);
    }
  }

  selectEnd(): void {
    if (this.pttHeld) {
      this.pttHeld = false;
      this.callbacks.pushToTalkEnd();
    }
  }

  cancelHold(): void {
    this.selectEnd();
  }
}
