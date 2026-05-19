import { getModelResponse, getResponseBody, isResponseComplete } from '../gemini-dom';
import { update as updateFollowup } from '../state/followups-state';

const HIDDEN_ATTR = 'data-ilui-claimed';
const PREV_DISPLAY_ATTR = 'data-ilui-prev-display';

export type MirrorHandle = {
  turnEl: HTMLElement;
  followupId: string;
  /** Stops the mirror observer but does NOT un-hide the turn. */
  stop: () => void;
  /** Stops the observer and restores the turn's previous display value. */
  unhide: () => void;
};

function getScrollContainer(): HTMLElement | null {
  return document.querySelector('infinite-scroller[data-test-id="chat-history-container"]');
}

/**
 * Hide the claimed turn (preserving the user's scroll position so Gemini's
 * auto-scroll-to-bottom doesn't yank the view) and start mirroring its
 * streaming `.markdown-main-panel` innerHTML into the followup's state.
 *
 * `savedScroll` is the scrollTop captured at submit time (in
 * `responseClaimer.startPending`) — BEFORE Gemini inserted the new turn.
 * Capturing it here would be too late: by the time the new-turn observer
 * fires Gemini has already scrolled to the bottom.
 *
 * The mirror observer watches childList + aria-busy. Each mutation updates
 * `answerHtml` + status='streaming'. Completion is detected via
 * `isResponseComplete` (aria-busy="false" or attribute absent with content).
 */
export function start(
  turnEl: HTMLElement,
  followupId: string,
  savedScroll: number,
  onComplete?: () => void,
): MirrorHandle {
  const scroller = getScrollContainer();

  turnEl.setAttribute(HIDDEN_ATTR, followupId);
  turnEl.setAttribute(PREV_DISPLAY_ATTR, JSON.stringify({
    visibility: turnEl.style.visibility,
    height: turnEl.style.height,
    overflow: turnEl.style.overflow,
    minHeight: turnEl.style.minHeight,
  }));
  // visibility:hidden keeps the element in Angular's rendering pipeline so
  // aria-busy updates correctly and Gemini's send button recovers on completion.
  // height:0 + overflow:hidden + minHeight:0 collapse it to zero layout space.
  turnEl.style.visibility = 'hidden';
  turnEl.style.height = '0';
  turnEl.style.overflow = 'hidden';
  turnEl.style.minHeight = '0';

  // Gemini auto-scrolls in multiple bursts: on turn insertion, on first
  // streamed chunk (which can land 500ms+ later), and intermittently while
  // streaming. A `scroll`-event listener catches these, but it fires AFTER
  // the scroll has already happened, so the browser paints one frame of the
  // scrolled-down state before we can snap back — that's the visible flash.
  //
  // To prevent the scroll from ever visually happening, we override the
  // `scrollTop` setter on the scroll container with a no-op. Gemini's
  // `scroller.scrollTop = scrollHeight` writes still execute, they just
  // don't do anything. User-initiated scrolling (wheel, touchpad, keyboard,
  // scrollbar drag) goes through the browser's native scroll pipeline, NOT
  // through the JS setter, so it continues to work normally — and triggers
  // our wheel/touchstart/keydown listeners which release the entire lock so
  // the user has full control once they express scroll intent.
  //
  // The scroll-event listener stays as a fallback for any code path that
  // bypasses the scrollTop setter (e.g. `scrollTo()`, `scrollIntoView()`).
  const protoScrollTopDesc = Object.getOwnPropertyDescriptor(
    Element.prototype,
    'scrollTop',
  );
  const origScrollTopSetter = protoScrollTopDesc?.set;
  const origScrollTopGetter = protoScrollTopDesc?.get;
  let scrollTopOverridden = false;

  let scrollLocked = true;
  const pinScroll = () => {
    if (!scrollLocked || !scroller) return;
    if (origScrollTopGetter && origScrollTopSetter) {
      const current = origScrollTopGetter.call(scroller) as number;
      if (current !== savedScroll) {
        origScrollTopSetter.call(scroller, savedScroll);
      }
    }
  };
  const releaseLock = () => {
    if (!scrollLocked) return;
    scrollLocked = false;
    // Remove the setter override too — once the user has expressed scroll
    // intent, programmatic scrolls should work again.
    if (scrollTopOverridden && scroller) {
      delete (scroller as unknown as { scrollTop?: number }).scrollTop;
      scrollTopOverridden = false;
    }
  };
  const teardownScrollLock = () => {
    scrollLocked = false;
    if (scrollTopOverridden && scroller) {
      delete (scroller as unknown as { scrollTop?: number }).scrollTop;
      scrollTopOverridden = false;
    }
    if (scroller) {
      scroller.removeEventListener('scroll', pinScroll);
      scroller.removeEventListener('wheel', releaseLock);
      scroller.removeEventListener('touchstart', releaseLock);
    }
    window.removeEventListener('keydown', releaseLock);
  };

  if (scroller && origScrollTopSetter && origScrollTopGetter) {
    // 1) Make sure we're at savedScroll right now (in case Gemini scrolled
    //    between submit and now), using the real setter directly.
    origScrollTopSetter.call(scroller, savedScroll);

    // 2) Install the no-op setter override on this specific instance. Reads
    //    still work (so Gemini's layout calculations are unaffected); writes
    //    are silently dropped.
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get() {
        return origScrollTopGetter.call(this);
      },
      set(_v: number) {
        // Programmatic scroll writes are dropped while the lock is active.
      },
    });
    scrollTopOverridden = true;

    // 3) Listeners: scroll event as a fallback; wheel/touch/keydown as
    //    user-intent signals that release the lock.
    scroller.addEventListener('scroll', pinScroll);
    scroller.addEventListener('wheel', releaseLock, { passive: true });
    scroller.addEventListener('touchstart', releaseLock, { passive: true });
    window.addEventListener('keydown', releaseLock);
  }

  const modelResponseEl = getModelResponse(turnEl);
  const panel = modelResponseEl ? getResponseBody(modelResponseEl) : null;

  // No panel yet? Sometimes the model-response child hasn't rendered in the new
  // turn shell. Poll briefly until it appears, then attach.
  let observer: MutationObserver | null = null;
  let attachTimer: number | null = null;
  let idleTimer: number | null = null;
  let stopped = false;

  // Gemini's Angular runtime may skip setting aria-busy="false" on display:none
  // elements, so the attribute-change path for completion can silently fail.
  // This idle timer fires if no mutations arrive for 1.5 s after the last one —
  // at that point streaming has clearly stopped and we force status='done'.
  const IDLE_DONE_MS = 3000;
  const resetIdleTimer = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = null;
      if (!stopped) captureAndUpdate('done');
    }, IDLE_DONE_MS);
  };

  const captureAndUpdate = (statusOverride?: 'streaming' | 'done') => {
    const mr = getModelResponse(turnEl);
    const p = mr ? getResponseBody(mr) : null;
    if (!p) return;
    const html = p.innerHTML;
    const done = mr ? isResponseComplete(mr) : false;
    const status = statusOverride ?? (done ? 'done' : 'streaming');
    updateFollowup(followupId, { answerHtml: html, status });
    if (status === 'done') {
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
      teardownScrollLock();
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      onComplete?.();
    }
  };

  const attach = (targetPanel: Element) => {
    observer = new MutationObserver(() => {
      if (stopped) return;
      captureAndUpdate();
      resetIdleTimer();
    });
    observer.observe(targetPanel, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-busy'],
    });
    // Capture once immediately in case content already streamed in before we
    // could attach.
    captureAndUpdate();
    resetIdleTimer();
  };

  if (panel) {
    attach(panel);
  } else {
    const tryAttach = () => {
      if (stopped) return;
      const mr = getModelResponse(turnEl);
      const p = mr ? getResponseBody(mr) : null;
      if (p) {
        attach(p);
      } else {
        attachTimer = window.setTimeout(tryAttach, 50);
      }
    };
    tryAttach();
  }

  const stop = () => {
    stopped = true;
    if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
    teardownScrollLock();
    if (attachTimer !== null) {
      clearTimeout(attachTimer);
      attachTimer = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  };

  const unhide = () => {
    stop();
    try {
      const prev = JSON.parse(turnEl.getAttribute(PREV_DISPLAY_ATTR) ?? '{}') as Record<string, string>;
      turnEl.style.visibility = prev.visibility ?? '';
      turnEl.style.height = prev.height ?? '';
      turnEl.style.overflow = prev.overflow ?? '';
      turnEl.style.minHeight = prev.minHeight ?? '';
    } catch { /* missing/malformed attribute — no restore needed */ }
    turnEl.removeAttribute(HIDDEN_ATTR);
    turnEl.removeAttribute(PREV_DISPLAY_ATTR);
  };

  return { turnEl, followupId, stop, unhide };
}
