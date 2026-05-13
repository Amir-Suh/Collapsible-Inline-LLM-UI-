type CollapseValue = 'collapsed' | 'expanded';

const state: Record<string, CollapseValue> = {};
const listeners = new Set<() => void>();

let currentConversationId = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  listeners.forEach(fn => fn());
}

function scheduleStorageWrite(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (!currentConversationId) return;
    chrome.storage.local.set({
      [`conv:${currentConversationId}:collapse`]: { ...state },
    });
  }, 500);
}

export function toggleTurn(turnId: string): void {
  const current = state[turnId] ?? 'expanded';
  state[turnId] = current === 'expanded' ? 'collapsed' : 'expanded';
  notify();
  scheduleStorageWrite();
}

export function setAllExpanded(): void {
  for (const id of Object.keys(state)) {
    state[id] = 'expanded';
  }
  notify();
  scheduleStorageWrite();
}

export function getTurnState(turnId: string): CollapseValue {
  return state[turnId] ?? 'expanded';
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadFromStorage(conversationId: string): Promise<void> {
  currentConversationId = conversationId;
  const key = `conv:${conversationId}:collapse`;
  const result = await chrome.storage.local.get(key);
  const stored = result[key] as Record<string, CollapseValue> | undefined;
  if (stored) {
    Object.assign(state, stored);
  }
}
