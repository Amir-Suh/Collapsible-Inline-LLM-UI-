import { getAllConversationTurns, getModelResponse, isResponseComplete } from '../gemini-dom';

function getChatScrollContainer(): Element | null {
  return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
}

/**
 * Starts watching the chat scroll container for completed model turns.
 *
 * Uses a single subtree observer on the scroll container watching for
 * aria-busy attribute changes. When aria-busy flips to "false" on any
 * .markdown-main-panel, we walk up to find the parent turn and fire the
 * callback. This handles new turns correctly even when the inner elements
 * don't exist yet at the time the turn container is added to the DOM.
 *
 * A completedTurnIds set prevents the callback firing more than once per turn.
 *
 * Returns a cleanup function that disconnects the observer.
 */
export function startResponseObserver(
  onTurnComplete: (turnEl: Element) => void
): () => void {
  const completedTurnIds = new Set<string>();

  function handleTurnComplete(turnEl: Element): void {
    const id = turnEl.id;
    if (!id || completedTurnIds.has(id)) return;
    completedTurnIds.add(id);
    onTurnComplete(turnEl);
  }

  // Handle turns already in the DOM (page reload with existing conversation).
  getAllConversationTurns().forEach(turnEl => {
    const modelResponseEl = getModelResponse(turnEl);
    if (modelResponseEl && isResponseComplete(modelResponseEl)) {
      handleTurnComplete(turnEl);
    }
  });

  const container = getChatScrollContainer();
  if (!container) return () => {};

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes') continue;
      const target = mutation.target as Element;
      if (target.getAttribute('aria-busy') !== 'false') continue;
      const turnEl = target.closest('.conversation-container[id]');
      if (turnEl) handleTurnComplete(turnEl);
    }
  });

  observer.observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  });

  return () => observer.disconnect();
}
