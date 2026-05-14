import { getAllConversationTurns, getModelResponse, isResponseComplete } from '../gemini-dom';

/**
 * Process every conversation turn currently in the DOM that has a completed
 * response. Used once when the user toggles inline mode on; the user has
 * already confirmed by clicking the toggle that the chat is in a steady,
 * fully-hydrated state, so no retries / polling are needed here.
 */
export function scanAllTurns(onTurnComplete: (turnEl: Element) => void): void {
  getAllConversationTurns().forEach(turnEl => {
    const modelResponseEl = getModelResponse(turnEl);
    if (modelResponseEl && isResponseComplete(modelResponseEl)) {
      onTurnComplete(turnEl);
    }
  });
}

/**
 * Starts watching for *new* completed model turns within the current chat.
 *
 * Only the `aria-busy="false"` transition is needed: while inline mode is on,
 * the user can send fresh prompts, and Gemini reliably toggles `aria-busy` on
 * the markdown panel when a streaming response finishes. We do not try to
 * detect SPA navigation here — that's handled in content-script by a URL
 * poller that disables inline mode (and tears everything down) on chat
 * switches. The user re-enables in the new chat.
 *
 * Returns a cleanup function that disconnects the observer.
 */
export function startResponseObserver(
  onTurnComplete: (turnEl: Element) => void
): () => void {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type !== 'attributes') continue;
      const target = mutation.target as Element;
      if (target.getAttribute('aria-busy') !== 'false') continue;
      const turnEl = target.closest?.('.conversation-container[id]');
      if (!turnEl) continue;
      const modelResponseEl = getModelResponse(turnEl);
      if (modelResponseEl && isResponseComplete(modelResponseEl)) {
        onTurnComplete(turnEl);
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-busy'],
  });

  return () => observer.disconnect();
}
