import { render } from 'preact';
import { Root } from './ui/Root';
import { CollapsibleHeader } from './ui/CollapsibleHeader';
import {
  runCanary,
  waitForChatReady,
  parseConversationId,
  getTurnId,
  getModelResponse,
  getResponseSummary,
} from './gemini-dom';
import { loadFromStorage, setAllExpanded, toggleTurn, getTurnState } from './state/collapse-state';
import { startResponseObserver } from './observers/response-observer';
import canaryCss from './styles/canary.css?inline';
import collapseHeaderCss from './styles/collapse-header.css?inline';

const HOST_ID = 'inline-ui-root';

// Tracks the most recent turn ID for Ctrl+[ shortcut.
let lastTurnId: string | null = null;

function getChatScrollContainer(): Element | null {
  return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
}

function injectHeader(turnEl: Element): void {
  const turnId = getTurnId(turnEl);
  if (!turnId) return;

  const modelResponseEl = getModelResponse(turnEl) as HTMLElement | null;
  if (!modelResponseEl) return;

  // Avoid injecting a second header if the turn was already processed.
  if (modelResponseEl.previousElementSibling?.classList.contains('ilui-header-host')) return;

  const summary = getResponseSummary(turnEl);
  const scrollContainer = getChatScrollContainer();

  const headerHost = document.createElement('div');
  headerHost.className = 'ilui-header-host';
  const headerShadow = headerHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = collapseHeaderCss;
  headerShadow.appendChild(style);

  const renderTarget = document.createElement('div');
  headerShadow.appendChild(renderTarget);

  modelResponseEl.parentElement?.insertBefore(headerHost, modelResponseEl);

  render(
    <CollapsibleHeader
      turnId={turnId}
      summary={summary}
      modelResponseEl={modelResponseEl}
      scrollContainer={scrollContainer}
    />,
    renderTarget,
  );

  // Apply persisted collapse state immediately after inject.
  if (getTurnState(turnId) === 'collapsed') {
    modelResponseEl.style.display = 'none';
  }

  lastTurnId = turnId;
}

function registerKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '[') {
      e.preventDefault();
      if (lastTurnId) toggleTurn(lastTurnId);
    } else if (e.key === ']') {
      e.preventDefault();
      setAllExpanded();
    }
  });
}

async function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = canaryCss;
  shadow.appendChild(style);

  const renderTarget = document.createElement('div');
  shadow.appendChild(renderTarget);

  const ready = await waitForChatReady();
  const canary = runCanary();
  if (ready.ok) {
    console.log('[InlineUI] canary:', canary);
  } else {
    console.warn('[InlineUI] canary timed out — still missing:', ready.missing, canary);
  }

  render(<Root canary={canary} />, renderTarget);

  if (!canary.ok) return;

  const conversationId = parseConversationId(location.pathname);
  if (conversationId) {
    await loadFromStorage(conversationId);
  }

  startResponseObserver(injectHeader);
  registerKeyboardShortcuts();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
} else {
  void mount();
}
