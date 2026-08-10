// Registers a cleanup callback for the currently mounted view.
let current: (() => void) | null = null;

export function onViewCleanup(fn: () => void) {
  current = fn;
}

export function runViewCleanup() {
  current?.();
  current = null;
}
