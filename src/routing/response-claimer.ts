import { getAllConversationTurns } from '../gemini-dom';

/**
 * Single-slot pending model. While a followup is awaiting Gemini's response,
 * we hold a snapshot of the turn IDs that existed at submit time. The first
 * turn that appears after that snapshot is the one Gemini just rendered for
 * our injected prompt — we claim it.
 *
 * Phase 4 concurrency rule (set in the plan): a second submit is blocked while
 * `hasPending()` returns true. There is no queue.
 */

type Pending = {
  followupId: string;
  knownTurnIds: Set<string>;
  /**
   * Snapshot of the chat scroll container's scrollTop at submit time, BEFORE
   * Gemini inserts the new turn and auto-scrolls. Captured here (not in
   * stream-mirror) because by the time the new-turn observer fires and stream-
   * mirror runs, Gemini has already moved scrollTop to the bottom.
   */
  scrollTopSnapshot: number;
};

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(fn => fn());
}

function getScrollContainer(): HTMLElement | null {
  return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
}

export function startPending(followupId: string): void {
  const scroller = getScrollContainer();
  pending = {
    followupId,
    knownTurnIds: new Set(getAllConversationTurns().map(t => t.id).filter(Boolean)),
    scrollTopSnapshot: scroller?.scrollTop ?? 0,
  };
  notify();
}

export type Claim = {
  followupId: string;
  turnEl: HTMLElement;
  scrollTopSnapshot: number;
};

export function tryClaim(): Claim | null {
  if (!pending) return null;
  const turns = getAllConversationTurns();
  const fresh = turns.find(t => t.id && !pending!.knownTurnIds.has(t.id));
  if (!fresh) return null;
  const claimed: Claim = {
    followupId: pending.followupId,
    turnEl: fresh,
    scrollTopSnapshot: pending.scrollTopSnapshot,
  };
  pending = null;
  notify();
  return claimed;
}

export function hasPending(): boolean {
  return pending !== null;
}

export function getPendingFollowupId(): string | null {
  return pending?.followupId ?? null;
}

export function abort(): void {
  if (!pending) return;
  pending = null;
  notify();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
