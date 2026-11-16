/** A value with change notification, for `useSyncExternalStore`. Lives outside React, so runtime code can write it. */
export class Store<T> {
  private readonly listeners = new Set<() => void>();
  constructor(private value: T) {}

  get = (): T => this.value;

  set(next: T): void {
    if (next === this.value) return;
    this.value = next;
    for (const listener of [...this.listeners]) listener();
  }

  update(change: (value: T) => T): void {
    this.set(change(this.value));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
