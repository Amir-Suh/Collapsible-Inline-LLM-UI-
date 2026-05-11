/**
 * The ONLY place Gemini-specific selectors live. When Gemini's DOM changes, patch here.
 *
 * Selectors below have been verified against gemini.google.com on the date this file
 * was last edited. If the canary starts failing, this file is the first place to look.
 */

export type Selector = {
  key: string;
  description: string;
  required: boolean;
  query: () => Element | null;
};

export const SELECTORS: Selector[] = [
  {
    key: 'chatScrollContainer',
    description: 'Scrollable container holding all conversation turns.',
    required: true,
    query: () => document.querySelector('infinite-scroller[data-test-id="chat-history-container"]'),
  },
  {
    key: 'conversationTurn',
    description: 'One user+model turn pair. The element id IS Gemini\'s stable turn ID.',
    required: false,
    query: () => document.querySelector('.conversation-container[id]'),
  },
  {
    key: 'modelResponse',
    description: 'Container for one Gemini response (the unit we will collapse).',
    required: false,
    query: () => document.querySelector('model-response'),
  },
  {
    key: 'composerInput',
    description: 'The Quill contenteditable inside the rich-textarea — where input events are dispatched.',
    required: true,
    query: () => document.querySelector('rich-textarea .ql-editor[contenteditable="true"]'),
  },
  {
    key: 'sendButton',
    description: 'Send-message button. Becomes aria-disabled="false" when the composer has content.',
    required: true,
    query: () => document.querySelector('button.send-button'),
  },
];

export type SelectorStatus = {
  key: string;
  description: string;
  required: boolean;
  found: boolean;
};

export type CanaryResult = {
  ok: boolean;
  checked: SelectorStatus[];
  conversationId: string | null;
};

export function runCanary(): CanaryResult {
  const checked: SelectorStatus[] = SELECTORS.map(s => ({
    key: s.key,
    description: s.description,
    required: s.required,
    found: !!s.query(),
  }));
  const ok = checked.filter(c => c.required).every(c => c.found);
  return {
    ok,
    checked,
    conversationId: parseConversationId(location.pathname),
  };
}

export function parseConversationId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return last === 'app' ? null : last;
}

/**
 * Gemini is an Angular SPA and parts of the page arrive on staggered ticks:
 * the chat shell first, then the composer/send button, then (if there is an
 * active conversation) the historical turns rehydrated from the server.
 *
 * This waits until everything we *expect* on the current URL is present:
 *   - On `/app` (no conversation): just the required selectors.
 *   - On `/app/<id>` (active conversation): required + optional selectors,
 *     because turns and responses should be in the DOM once Gemini hydrates.
 *
 * Resolves with `ok: true` once everything expected has arrived. On timeout,
 * `ok` reflects whether the required selectors are present; `missing` lists
 * any still-absent keys so the canary can surface them.
 */
export function waitForChatReady(
  timeoutMs = 15000
): Promise<{ ok: boolean; missing: string[] }> {
  const required = SELECTORS.filter(s => s.required);
  const inConversation = parseConversationId(location.pathname) !== null;
  const targets = inConversation ? SELECTORS : required;
  const stillMissing = () => targets.filter(s => !s.query()).map(s => s.key);

  if (stillMissing().length === 0) return Promise.resolve({ ok: true, missing: [] });

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      observer.disconnect();
      const missing = stillMissing();
      const ok = required.every(s => !!s.query());
      resolve({ ok, missing });
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      if (stillMissing().length === 0) {
        clearTimeout(timer);
        observer.disconnect();
        resolve({ ok: true, missing: [] });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// ---------------------------------------------------------------------------
// Helpers for working with the confirmed elements.
// Phase 2+ should consume these instead of reaching for DOM details directly.
// ---------------------------------------------------------------------------

export function getAllConversationTurns(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.conversation-container[id]'));
}

export function getTurnId(turnEl: Element): string | null {
  return turnEl.id || null;
}

export function getModelResponse(turnEl: Element): Element | null {
  return turnEl.querySelector('model-response');
}

/**
 * Whether a model response has finished streaming. Gemini toggles
 * `aria-busy` on the inner markdown panel between "true" (streaming)
 * and "false" (done). The `.response-footer.complete` class is a
 * secondary corroborator we accept if aria-busy is missing.
 */
export function isResponseComplete(modelResponseEl: Element): boolean {
  const panel = modelResponseEl.querySelector('.markdown-main-panel');
  if (panel) return panel.getAttribute('aria-busy') === 'false';
  return !!modelResponseEl.querySelector('.response-footer.complete');
}

export function getComposerInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>('rich-textarea .ql-editor[contenteditable="true"]');
}

export function getSendButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button.send-button');
}

export function isSendButtonReady(): boolean {
  const btn = getSendButton();
  if (!btn) return false;
  return btn.getAttribute('aria-disabled') !== 'true';
}
