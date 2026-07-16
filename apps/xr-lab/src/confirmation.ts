export interface ArmedAction<T> {
  operation: T;
  label: string;
  armedAt: number;
  expiresAt: number;
}

export class ConfirmationGate<T> {
  private armed: ArmedAction<T> | null = null;
  private listeners = new Set<(armed: ArmedAction<T> | null) => void>();

  constructor(
    private ttlMs = 8_000,
    private now: () => number = () => Date.now(),
  ) {}

  arm(operation: T, label: string): ArmedAction<T> {
    const armedAt = this.now();
    this.armed = { operation, label, armedAt, expiresAt: armedAt + this.ttlMs };
    this.emit();
    return this.armed;
  }

  current(): ArmedAction<T> | null {
    this.expireIfNeeded();
    return this.armed;
  }

  cancel(): void {
    if (this.armed !== null) {
      this.armed = null;
      this.emit();
    }
  }

  takeConfirmed(): T | null {
    this.expireIfNeeded();
    const operation = this.armed?.operation ?? null;
    this.armed = null;
    this.emit();
    return operation;
  }

  tick(): void {
    this.expireIfNeeded();
  }

  subscribe(listener: (armed: ArmedAction<T> | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private expireIfNeeded(): void {
    if (this.armed !== null && this.now() >= this.armed.expiresAt) {
      this.armed = null;
      this.emit();
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.armed);
    }
  }
}
