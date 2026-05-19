import type { CheckedBlock } from './checked-blocks-state';

export type FollowupStatus =
  | 'pending'    // created in state, not yet sent to Gemini
  | 'submitted'  // injected into Gemini composer + send clicked, no turn claimed yet
  | 'streaming'  // turn claimed + mirror observer is updating answerHtml
  | 'done'       // stream complete, final answerHtml captured
  | 'error';     // submission failed (composer occupied, send never enabled, etc.)

export type Followup = {
  id: string;
  status: FollowupStatus;
  anchorBlockId: string;
  referencedBlocks: CheckedBlock[];
  question: string;
  answerHtml: string | null;
  errorMessage: string | null;
};

const byAnchor = new Map<string, Followup[]>();
const listeners = new Set<() => void>();
let idCounter = 0;

function notify(): void {
  listeners.forEach(fn => fn());
}

export function add(input: {
  anchorBlockId: string;
  referencedBlocks: CheckedBlock[];
  question: string;
}): Followup {
  const followup: Followup = {
    id: `fu-${++idCounter}`,
    status: 'pending',
    anchorBlockId: input.anchorBlockId,
    referencedBlocks: input.referencedBlocks,
    question: input.question,
    answerHtml: null,
    errorMessage: null,
  };
  const existing = byAnchor.get(input.anchorBlockId) ?? [];
  byAnchor.set(input.anchorBlockId, [...existing, followup]);
  notify();
  console.log('[InlineUI] submit', followup);
  return followup;
}

export function update(id: string, patch: Partial<Omit<Followup, 'id'>>): void {
  for (const [anchor, list] of byAnchor) {
    const idx = list.findIndex(f => f.id === id);
    if (idx === -1) continue;
    const next = [...list];
    next[idx] = { ...next[idx], ...patch };
    byAnchor.set(anchor, next);
    notify();
    return;
  }
}

export function getById(id: string): Followup | null {
  for (const list of byAnchor.values()) {
    const found = list.find(f => f.id === id);
    if (found) return found;
  }
  return null;
}

export function getFor(anchorBlockId: string): Followup[] {
  return byAnchor.get(anchorBlockId) ?? [];
}

export function getAllAnchorIds(): string[] {
  return Array.from(byAnchor.keys());
}

export function isAnyStreaming(): boolean {
  for (const list of byAnchor.values()) {
    if (list.some(f => f.status === 'streaming')) return true;
  }
  return false;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
