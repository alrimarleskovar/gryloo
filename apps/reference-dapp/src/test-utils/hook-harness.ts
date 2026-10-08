// SPDX-License-Identifier: AGPL-3.0-only
// Extends the existing Review test hook-runner approach with effect cleanup and stable hook slots.
// Production hooks/reducers remain unchanged; asynchronous ports are controlled by each test.
type Slot = { value: unknown; deps?: readonly unknown[] | undefined; cleanup?: (() => void) | undefined };
let active: HookHarness | null = null;
const activate = (host: HookHarness) => { const previous = active; active = host; return () => { active = previous; }; };
const same = (a?: readonly unknown[], b?: readonly unknown[]) => Boolean(a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
export class HookHarness {
  slots: Slot[] = [];
  index = 0;
  dirty = false;
  effects: (() => void)[] = [];
  slot(initial: () => unknown): Slot {
    const index = this.index++;
    return this.slots[index] ??= { value: initial() };
  }
  render<T>(read: () => T): T {
    let result!: T;
    for (let pass = 0; pass < 25; pass++) {
      this.index = 0; this.dirty = false; this.effects = [];
      const restore = activate(this);
      try { result = read(); } finally { restore(); }
      for (const effect of this.effects) effect();
      if (!this.dirty) return result;
    }
    throw Error('TEST_HOOK_RENDER_LOOP');
  }
  unmount() { for (const slot of this.slots) { slot.cleanup?.(); slot.cleanup = undefined; } }
}
const current = () => { if (!active) throw Error('TEST_HOOK_HARNESS_MISSING'); return active; };
export const hookMocks = {
  useState<T>(initial: T | (() => T)): [T, (update: T | ((value: T) => T)) => void] {
    const host = current(), slot = host.slot(() => typeof initial === 'function' ? (initial as () => T)() : initial);
    return [slot.value as T, update => {
      const next = typeof update === 'function' ? (update as (value: T) => T)(slot.value as T) : update;
      if (!Object.is(next, slot.value)) { slot.value = next; host.dirty = true; }
    }];
  },
  useRef<T>(initial: T): { current: T } { return current().slot(() => ({ current: initial })).value as { current: T }; },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const host = current(), slot = host.slot(() => undefined);
    if (!same(slot.deps, deps)) {
      slot.deps = deps;
      host.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
  useMemo<T>(read: () => T, deps?: readonly unknown[]): T {
    const slot = current().slot(() => undefined);
    if (!same(slot.deps, deps)) { slot.value = read(); slot.deps = deps; }
    return slot.value as T;
  },
  useCallback<T>(callback: T, deps?: readonly unknown[]): T { return hookMocks.useMemo(() => callback, deps); },
  useReducer(reduce: (value: unknown, action: unknown) => unknown, initial: unknown, initialize?: (value: unknown) => unknown) {
    const [value, setValue] = hookMocks.useState(() => initialize ? initialize(initial) : initial);
    return [value, (action: unknown) => setValue((previous: unknown) => reduce(previous, action))];
  },
};
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
