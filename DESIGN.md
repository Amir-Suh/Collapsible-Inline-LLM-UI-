# Collapsible Inline LLM UI — Design Doc

## Context

Today, conversing with Gemini is a linear scroll. Once a response is read, it stops being useful but keeps consuming vertical space, so finding an earlier answer means scrolling past everything since. Asking a follow-up always sends the user to the bottom of the page, even when the question is about something near the top — which doesn't match how people actually think (non-linearly, by jumping back to specific ideas).

This project ships a **Chrome extension** that injects a UI layer onto `gemini.google.com`. The injected UI:

1. **Collapses prior responses** so the conversation is scannable.
2. **Lets the user highlight any piece of a response and ask a follow-up inline**, with the answer rendered as a nested sub-list under the highlighted block — instead of appended to the bottom of the page.

Conceptually, each top-level Gemini response is a node in a list; each block within that response (paragraph, code fence, list item, heading) can spawn a child sub-list of follow-up Q&A pairs. The whole conversation becomes a tree, not a stream.

This is **Option 1 (DOM injection)** from the user's brief. The known trade-off is brittleness: Gemini's auto-generated class names will shift, so the design explicitly invests in a DOM-adapter layer and a "canary" health check rather than hard-coded selectors scattered through the code.

---

## Tech Stack

| Concern | Choice | Why |
|---|---|---|
| Extension manifest | **Manifest V3** | Required for new Chrome Web Store submissions; service-worker background. |
| Language | **TypeScript** | Types catch DOM-shape drift early; pays off when Gemini changes its markup. |
| UI framework | **Preact** (`preact/hooks`) | ~3KB runtime, React-like ergonomics, great fit for a nested-tree UI. Plays cleanly inside Shadow DOM. |
| Style isolation | **Shadow DOM** + scoped CSS | Prevents Gemini's stylesheet from bleeding into our UI and vice versa. |
| Styling | **CSS Modules** (or plain CSS-in-Shadow) | No Tailwind — runtime class generation collides with Shadow DOM and bloats the bundle. |
| Build | **Vite** + `@crxjs/vite-plugin` | HMR for content scripts, MV3-aware bundling, single command for dev + zip. |
| DOM observation | **MutationObserver** | Detect new Gemini turns, response streaming completion, and route changes (Gemini is an SPA). |
| Follow-up routing | **Programmatic composer injection** | Inject the question into Gemini's own `<rich-textarea>`, dispatch input events, click send, then intercept the streamed response in the DOM. No API key needed. |
| Persistence | **`chrome.storage.local`** | Per-conversation tree state, keyed by Gemini's conversation ID parsed from the URL. ~10MB quota is plenty for text. |
| Selection model | **Range / Selection API** + `Node.compareDocumentPosition` | Map a user highlight onto the block element that contains it. |
| Testing | **Vitest** (unit) + **Playwright** (E2E against a recorded Gemini DOM fixture) | E2E against real Gemini is flaky; record fixtures and replay. |

---

## Phase 1 — Foundation & DOM Reconnaissance

**Goal:** Stand up the extension scaffolding and lock down a resilient model of Gemini's DOM.

- Initialize Vite + `@crxjs/vite-plugin` + Preact + TS project. Manifest V3 with a single content script matched to `https://gemini.google.com/*`.
- Create a **DOM adapter module** (`src/gemini-dom.ts`) that is the *only* place Gemini-specific selectors live. Every other file talks to Gemini through this adapter. When Gemini changes its markup, this is the file we patch.
- Reconnaissance: catalogue the structural elements we depend on —
  - The conversation turn container (user turn + model turn pair).
  - The model response container and its streamed-completion signal (Gemini sets an attribute / removes a "loading" marker when streaming finishes — pin down which).
  - The composer textarea and send button.
  - The route / conversation ID (typically in `location.pathname`).
- Add a **DOM canary**: on script boot, assert each selector resolves; if any fails, render a non-intrusive banner ("Inline UI extension is out of date — Gemini's interface changed") and short-circuit the rest of the feature instead of crashing.
- Mount a root `<div id="inline-ui-root">` *adjacent* to Gemini's chat scroll container; attach a Shadow DOM root for our UI.

**Critical files:**
- `manifest.json`
- `src/content-script.ts` — entry, mounts Preact root, kicks off observers.
- `src/gemini-dom.ts` — selector adapter + canary.
- `vite.config.ts`

---

## Phase 2 — Collapsible Responses

**Goal:** Every model response gets a collapse/expand affordance. Header stays visible (first line or auto-generated summary), body hides.

- A `ResponseObserver` (MutationObserver on the chat scroll container) emits an event each time a model turn finishes streaming.
- For each completed model turn, inject a **header bar** above the response with: chevron toggle, the first ~80 chars of the response as a summary, timestamp.
- Toggling collapses the response by setting `display: none` on Gemini's response body (we own the wrapper, not the inner content). Preserve scroll anchor so the user's viewport doesn't jump.
- All responses start expanded. Collapse is purely user-driven via the chevron — no auto-collapse when a new turn arrives.
- Keyboard: `Cmd/Ctrl + [` collapse current, `Cmd/Ctrl + ]` expand all.

**State:** Per-conversation map of `{turnId: 'collapsed' | 'expanded'}` held in a Preact signal, mirrored to `chrome.storage.local` (debounced 500ms).

**Critical files:**
- `src/observers/response-observer.ts`
- `src/ui/CollapsibleHeader.tsx`
- `src/state/collapse-state.ts`

---

## Phase 3 — Block Detection & Inline Selection UI

**Goal:** Identify the "blocks" inside a response and offer an inline action when the user highlights text within one.

- **Block definition:** every direct child of the response body that is one of `<p>`, `<pre>`, `<ul>/<ol>` (treated as one block), `<h1..h6>`, `<table>`. Each gets a stable, content-derived ID (`hash(textContent) + index`) so we can reference it after re-render.
- On `selectionchange`, if the selection's `commonAncestorContainer` lies inside a model response, locate the enclosing block via `Node.compareDocumentPosition` against the cached block list.
- Render a **floating action button** (positioned at the selection's bounding rect) inside our Shadow root: "Ask about this".
- Clicking opens an inline composer *anchored beneath the parent block* (not at the page bottom) — a small textarea with submit button, pre-filled with the highlighted text as quoted context.

**Critical files:**
- `src/blocks/block-parser.ts` — walks a response, assigns block IDs.
- `src/ui/SelectionActionButton.tsx`
- `src/ui/InlineComposer.tsx`

---

## Phase 4 — Inline Follow-up Submission via Composer Hijack

**Goal:** Send the follow-up through Gemini's real composer, capture the response, and re-parent it under the originating block as a sub-list entry.

This is the riskiest phase. The flow:

1. **Submit:** Build a prompt of the form `> {highlighted text}\n\n{user's follow-up}` and write it into Gemini's composer (`HTMLTextAreaElement.value` won't trigger React state; instead use the input-element setter + dispatch an `InputEvent` with `inputType: 'insertText'`). Click send.
2. **Intercept:** Tag the *expected* next response turn. The `ResponseObserver` from Phase 2 sees a new model turn start; if there is a pending inline request, claim it.
3. **Hide from main flow:** As soon as the new turn is detected, set its container to `display: none` so it never visually appears at the bottom of the page.
4. **Mirror into sub-list:** Move the response's *content* (or a live-mirrored copy) into a new sub-list node under the parent block. Keep mirroring while streaming until Gemini signals completion, then detach the original turn node entirely.
5. **Sub-list is itself recursive:** Each follow-up answer is a block tree too. The same selection → "Ask about this" flow works on it, allowing arbitrary nesting (cap depth at 5 for sanity).

**Edge cases to handle:**
- User types a normal message in the main composer while a sub-request is pending → queue our request, don't race.
- Gemini errors / rate-limits → surface the error inside the sub-list, allow retry.
- User navigates away mid-stream → abort cleanly, drop the partial sub-list entry.

**Critical files:**
- `src/routing/composer-bridge.ts` — input dispatch + send.
- `src/routing/response-claimer.ts` — pending-request queue, ownership of next turn.
- `src/ui/SubListNode.tsx`

---

## Phase 5 — Conversation Tree & Persistence

**Goal:** The whole structure (collapse state + sub-list tree per parent block) survives page reload.

- Data model:
  ```ts
  type Conversation = {
    conversationId: string;
    turns: Turn[];
  };
  type Turn = {
    turnId: string;
    collapsed: boolean;
    blocks: Block[];
  };
  type Block = {
    blockId: string;          // content hash
    children: Followup[];     // sub-list under this block
  };
  type Followup = {
    id: string;
    quotedText: string;
    question: string;
    answerHtml: string;       // sanitized, stored as HTML for fidelity
    children: Followup[];     // nested sub-list (recursive)
  };
  ```
- Persist with `chrome.storage.local`, key = `conv:{conversationId}`. Debounce writes.
- On script load, after the DOM canary passes, hydrate state for the current conversation; walk Gemini's rendered turns, match them to stored turns by `turnId` (Gemini's own DOM attribute, or fall back to content hash), and re-render collapse state + sub-lists.
- Handle missing matches gracefully — if a stored sub-list's parent block no longer exists (Gemini regenerated the response), park it under a "Orphaned follow-ups" expander rather than dropping it.

**Critical files:**
- `src/state/store.ts` — Preact signals + storage sync.
- `src/state/hydrate.ts` — boot-time reconciliation.

---

## Phase 6 — Resilience, Polish, and Onboarding

**Goal:** Ship-ready quality and graceful failure when Gemini changes.

- **DOM-change detection:** Beyond the boot canary, run a periodic (every 30s) re-check of critical selectors. On failure, freeze writes to storage (so we don't corrupt the tree) and surface the "out of date" banner.
- **Onboarding overlay:** First-run tooltip explaining the collapse chevron and the "highlight → ask" gesture.
- **Settings panel** (popup action): max nesting depth, "pause extension" kill-switch.
- **Accessibility:** All toggles keyboard-reachable; ARIA `aria-expanded` on collapse headers; floating action button focusable.
- **Telemetry (opt-in only):** Local-only counters for "blocks parsed," "follow-ups sent," "canary failures." No data leaves the browser.
- **Performance:** Bound the MutationObserver to the chat scroll container only, not `document`. Debounce selection-change handling at 100ms.

**Critical files:**
- `src/health/canary.ts`
- `src/ui/Onboarding.tsx`
- `src/ui/SettingsPopup.tsx`

---

## Verification

End-to-end check after each phase:

1. **Phase 1:** Load unpacked extension in Chrome, visit `gemini.google.com`, confirm canary banner is absent and `<inline-ui-root>` is mounted (inspect DOM).
2. **Phase 2:** Send 3 prompts in a Gemini chat. Each prior response auto-collapses when the next arrives; clicking the chevron expands. Reload page — collapse states persist.
3. **Phase 3:** Highlight text inside a response. Floating "Ask about this" appears next to the selection. Clicking opens an inline composer beneath the parent block.
4. **Phase 4:** Type a follow-up, submit. Verify: (a) the answer streams *into the sub-list*, never appearing at page bottom; (b) the page does not auto-scroll to the bottom; (c) a second follow-up on the *same* highlighted block adds another sub-list entry, not replacing the first.
5. **Phase 5:** Hard-refresh the page mid-conversation. All collapse states and sub-list answers come back exactly as left.
6. **Phase 6:** Manually break a selector in `gemini-dom.ts`, reload — the banner appears, the rest of the UI does not crash, no storage corruption.

Automated:
- `vitest` unit tests for block parsing, selection→block mapping, and store reducers.
- Playwright run against a recorded Gemini DOM fixture (snapshot of HTML + a faked streaming response) covering the Phase 2–5 flows.

---

## Known Risks

- **Composer hijack is the load-bearing trick.** If Gemini ever switches to a Server-Sent-Events-only flow that doesn't render to the DOM, Phase 4 collapses. Mitigation: the DOM adapter isolates this, and the same UI shell could be ported to direct Gemini API calls later.
- **Block ID stability.** Content-hash IDs change if Gemini re-streams. Mitigation: store *both* hash and ordinal index; match on hash first, ordinal as fallback, surface orphans rather than dropping.
- **Selector drift.** Mitigated by the adapter, canary, and frozen-write fallback — but realistically expect a patch release every 1–3 months.
