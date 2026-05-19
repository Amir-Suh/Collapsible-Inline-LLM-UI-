import { render } from 'preact';
import { Root } from './ui/Root';
import { CollapsibleHeader } from './ui/CollapsibleHeader';
import { BlockCheckbox } from './ui/BlockCheckbox';
import { InlineComposer } from './ui/InlineComposer';
import { PendingFollowup } from './ui/PendingFollowup';
import {
  runCanary,
  waitForChatReady,
  parseConversationId,
  getTurnId,
  getModelResponse,
  getResponseBody,
  getResponseSummary,
} from './gemini-dom';
import { loadFromStorage, setAllExpanded, toggleTurn, getTurnState } from './state/collapse-state';
import { startResponseObserver, scanAllTurns } from './observers/response-observer';
import { parseBlocks, type Block } from './blocks/block-parser';
import { setBlocks, getQuotePreview } from './blocks/block-cache';
import {
  getAnchorBlockId,
  clear as clearCheckedBlocks,
  subscribe as subscribeChecked,
} from './state/checked-blocks-state';
import { clearDraft } from './state/composer-state';
import {
  subscribe as subscribeFollowups,
  getAllAnchorIds,
} from './state/followups-state';
import {
  isEnabled as isInlineEnabled,
  setEnabled as setInlineEnabled,
  subscribe as subscribeInlineMode,
} from './state/inline-mode-state';
import { onNewTurn, abortAllInFlight } from './routing';
import { tryClaim } from './routing/response-claimer';
import canaryCss from './styles/canary.css?inline';
import collapseHeaderCss from './styles/collapse-header.css?inline';
import blockCheckboxCss from './styles/block-checkbox.css?inline';
import inlineComposerCss from './styles/inline-composer.css?inline';
import pendingFollowupCss from './styles/pending-followup.css?inline';
import inlineToggleCss from './styles/inline-toggle.css?inline';

const HOST_ID = 'inline-ui-root';

// Tracks the most recent turn ID for Ctrl+[ shortcut.
let lastTurnId: string | null = null;

function getChatScrollContainer(): Element | null {
  return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
}

// === Collapse header (Phase 2; runs unconditionally — not gated by inline mode) ===

function injectHeader(turnEl: Element): void {
  const turnId = getTurnId(turnEl);
  if (!turnId) return;

  const modelResponseEl = getModelResponse(turnEl) as HTMLElement | null;
  if (!modelResponseEl) return;

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

  if (getTurnState(turnId) === 'collapsed') {
    modelResponseEl.style.display = 'none';
  }

  lastTurnId = turnId;
}

// === Block checkbox injection (gated by inline mode) ===

function injectBlockCheckbox(block: Block, turnId: string): void {
  if (block.element.querySelector(':scope > .ilui-checkbox-host')) return;

  const host = document.createElement('div');
  host.className = 'ilui-checkbox-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = blockCheckboxCss;
  shadow.appendChild(style);

  const target = document.createElement('div');
  shadow.appendChild(target);

  block.element.insertBefore(host, block.element.firstChild);

  render(
    <BlockCheckbox
      blockId={block.blockId}
      turnId={turnId}
      quotedText={getQuotePreview(block.blockId)}
    />,
    target,
  );
}

function parseTurnBlocks(turnEl: Element): void {
  const turnId = getTurnId(turnEl);
  if (!turnId) return;

  const modelResponseEl = getModelResponse(turnEl);
  if (!modelResponseEl) return;

  const responseBody = getResponseBody(modelResponseEl);
  if (!responseBody) return;

  const blocks = parseBlocks(responseBody);
  setBlocks(turnId, blocks);
  blocks.forEach(b => injectBlockCheckbox(b, turnId));
  syncComposer();
  syncFollowups();

  // Watch for Gemini re-rendering the panel children (settling animations, etc.)
  // so our data-ilui-block-id stamps and checkbox hosts survive.
  if (responseBody.hasAttribute('data-ilui-observed')) return;
  responseBody.setAttribute('data-ilui-observed', 'true');
  const panelObserver = new MutationObserver(mutations => {
    if (!isInlineEnabled()) return; // bailing out cheaply when toggle is off
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!isOwnHost(node)) {
          const reparsed = parseBlocks(responseBody);
          setBlocks(turnId, reparsed);
          reparsed.forEach(b => injectBlockCheckbox(b, turnId));
          syncComposer();
          syncFollowups();
          return;
        }
      }
      for (const node of m.removedNodes) {
        if (!isOwnHost(node)) {
          const reparsed = parseBlocks(responseBody);
          setBlocks(turnId, reparsed);
          reparsed.forEach(b => injectBlockCheckbox(b, turnId));
          syncComposer();
          syncFollowups();
          return;
        }
      }
    }
  });
  panelObserver.observe(responseBody, { childList: true });
}

const OWN_HOST_CLASSES = [
  'ilui-checkbox-host',
  'ilui-composer-host',
  'ilui-followup-host',
  'ilui-header-host',
];

function isOwnHost(node: Node): boolean {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  return OWN_HOST_CLASSES.some(c => el.classList?.contains(c));
}

// === Composer host management ===

let composerHost: HTMLElement | null = null;
let composerRenderTarget: HTMLElement | null = null;

function destroyComposer(): void {
  if (composerRenderTarget) render(null, composerRenderTarget);
  if (composerHost) composerHost.remove();
  composerHost = null;
  composerRenderTarget = null;
}

function syncComposer(): void {
  const anchorId = getAnchorBlockId();
  if (!anchorId) {
    destroyComposer();
    return;
  }

  const anchor = document.querySelector<HTMLElement>(`[data-ilui-block-id="${anchorId}"]`);
  if (!anchor) return;

  if (!composerHost || !composerHost.isConnected) {
    destroyComposer();
    composerHost = document.createElement('div');
    composerHost.className = 'ilui-composer-host';
    const shadow = composerHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = inlineComposerCss;
    shadow.appendChild(style);

    composerRenderTarget = document.createElement('div');
    shadow.appendChild(composerRenderTarget);

    render(<InlineComposer />, composerRenderTarget);
  }

  if (anchor.nextSibling !== composerHost) {
    anchor.parentNode?.insertBefore(composerHost, anchor.nextSibling);
  }
}

// === Followup host management ===

const followupHosts = new Map<string, { host: HTMLElement; target: HTMLElement }>();

function ensureFollowupHostFor(anchorBlockId: string): void {
  const anchor = document.querySelector<HTMLElement>(`[data-ilui-block-id="${anchorBlockId}"]`);
  if (!anchor) return;

  const existing = followupHosts.get(anchorBlockId);
  if (existing && existing.host.isConnected) {
    if (anchor.nextSibling !== existing.host && anchor.nextSibling !== composerHost) {
      anchor.parentNode?.insertBefore(existing.host, anchor.nextSibling);
    }
    return;
  }

  if (existing) render(null, existing.target);

  const host = document.createElement('div');
  host.className = 'ilui-followup-host';
  host.setAttribute('data-anchor', anchorBlockId);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = pendingFollowupCss;
  shadow.appendChild(style);

  const target = document.createElement('div');
  shadow.appendChild(target);

  if (anchor.nextSibling !== host) {
    anchor.parentNode?.insertBefore(host, anchor.nextSibling);
  }
  render(<PendingFollowup anchorBlockId={anchorBlockId} />, target);
  followupHosts.set(anchorBlockId, { host, target });
}

function syncFollowups(): void {
  for (const anchorId of getAllAnchorIds()) {
    ensureFollowupHostFor(anchorId);
  }
}

// === Toggle wiring ===

let responseObserverCleanup: (() => void) | null = null;
let newTurnObserver: MutationObserver | null = null;

function startNewTurnObserver(): void {
  const scroller = getChatScrollContainer();
  if (!scroller) return;
  newTurnObserver = new MutationObserver(() => {
    // Any DOM change inside the scroll container might be a new turn arriving.
    // tryClaim() is cheap: it's a no-op when nothing is pending.
    onNewTurn(tryClaim);
  });
  newTurnObserver.observe(scroller, { childList: true, subtree: true });
}

function stopNewTurnObserver(): void {
  newTurnObserver?.disconnect();
  newTurnObserver = null;
}

function enableInlineMode(): void {
  // Inject onto every turn currently in the DOM.
  scanAllTurns(parseTurnBlocks);
  // Watch for new prompts completing within this chat.
  responseObserverCleanup = startResponseObserver(turnEl => {
    if (isInlineEnabled()) parseTurnBlocks(turnEl);
  });
  // Watch for newly-added turns so we can claim them for in-flight followups.
  startNewTurnObserver();
}

function disableInlineMode(): void {
  // Abort any in-flight followup first so any hidden turn gets un-hidden and
  // its response renders normally at page bottom. (Plan: graceful degradation.)
  abortAllInFlight();

  // Stop watching for new completions / new turns.
  responseObserverCleanup?.();
  responseObserverCleanup = null;
  stopNewTurnObserver();

  // Remove all injected checkbox / composer / followup hosts.
  document.querySelectorAll('.ilui-checkbox-host').forEach(el => el.remove());
  destroyComposer();
  for (const { host, target } of followupHosts.values()) {
    render(null, target);
    host.remove();
  }
  followupHosts.clear();

  // Clear transient in-memory state. (Followup data stays in followups-state
  // so it can be re-rendered if the user re-enables in the same chat.)
  clearCheckedBlocks();
  clearDraft();
}

// === Keyboard shortcuts (Phase 2; not gated) ===

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

// === Mount ===

async function mount() {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Overlay styles: canary banner + the floating Inline toggle live here.
  const overlayStyle = document.createElement('style');
  overlayStyle.textContent = `${canaryCss}\n${inlineToggleCss}`;
  shadow.appendChild(overlayStyle);

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

  // Collapse headers inject on every turn regardless of inline mode (Phase 2 feature).
  startResponseObserver(injectHeader);
  // Also inject onto any turns already in the DOM at boot.
  scanAllTurns(injectHeader);

  registerKeyboardShortcuts();

  // React to the user toggling inline mode on/off.
  subscribeInlineMode(() => {
    if (isInlineEnabled()) enableInlineMode();
    else disableInlineMode();
  });

  // Composer + followup hosts respond to checked-block changes and new followups.
  subscribeChecked(syncComposer);
  subscribeFollowups(syncFollowups);

  // Per-chat manual scope: disable inline mode on any URL change so the user
  // gets a clean state in the new chat and can re-enable when ready.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (isInlineEnabled()) setInlineEnabled(false);
  }, 300);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
} else {
  void mount();
}
