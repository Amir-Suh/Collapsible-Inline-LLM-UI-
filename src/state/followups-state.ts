import type { CheckedBlock } from './checked-blocks-state';

export type FollowupStatus = 'pending'; // Phase 4 will extend to 'streaming' | 'done' | 'error'.

export type Followup = {
  id: string;
  status: FollowupStatus;
  anchorBlockId: string;
  referencedBlocks: CheckedBlock[];
  question: string;
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
  };
  const existing = byAnchor.get(input.anchorBlockId) ?? [];
  byAnchor.set(input.anchorBlockId, [...existing, followup]);
  notify();
  console.log('[InlineUI] submit', followup);
  return followup;
}

export function getFor(anchorBlockId: string): Followup[] {
  return byAnchor.get(anchorBlockId) ?? [];
}

export function getAllAnchorIds(): string[] {
  return Array.from(byAnchor.keys());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
