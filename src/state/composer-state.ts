// Module-scoped state for the inline composer's textarea draft.
// Held outside any component so it survives the composer host being moved
// or re-mounted when the anchor block changes or Gemini re-renders.

let draft = '';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

export function getDraft(): string {
  return draft;
}

export function setDraft(text: string): void {
  if (text === draft) return;
  draft = text;
  notify();
}

export function clearDraft(): void {
  setDraft('');
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
