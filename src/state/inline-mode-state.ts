// Per-chat manual gate for the inline-checkbox feature.
// Resets to OFF on every navigation (handled in content-script).

let enabled = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

export function isEnabled(): boolean {
  return enabled;
}

export function setEnabled(value: boolean): void {
  if (value === enabled) return;
  enabled = value;
  notify();
}

export function toggle(): void {
  setEnabled(!enabled);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
