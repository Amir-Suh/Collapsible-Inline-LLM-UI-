# Phase 4 — Demo & Verification

Phase 4 closes the loop: submitting a follow-up from the inline composer now **actually sends the question to Gemini through its own composer**, claims the resulting turn before it can render at the bottom of the page, hides that turn, and live-mirrors its streaming output into the placeholder card.

What Phase 4 delivers:

1. Clicking **Ask** in the inline composer hijacks Gemini's `.ql-editor`: writes a Markdown-blockquote prompt of every referenced block followed by the question, dispatches an `InputEvent`, waits for the send button to enable, then clicks send.
2. A new `childList` MutationObserver on the chat scroll container detects the new `.conversation-container[id]` Gemini inserts in response, and **claims** it for the in-flight follow-up.
3. The claimed turn is hidden (`display: none`) and the user's scroll position is held (Gemini's auto-scroll-to-bottom is suppressed across 6 frames).
4. A `streamMirror` observer watches the hidden turn's `.markdown-main-panel` and live-updates the follow-up card's body with the streaming HTML. The "Pending answer…" placeholder is replaced by the real content as it streams.
5. On `aria-busy → "false"` (or attribute absent with content rendered), the follow-up flips to status `'done'`, the streaming pulse stops, and the mirror observer disconnects.
6. While a follow-up is in flight (`'submitted'` or `'streaming'`), the **Ask** button in the inline composer is disabled with an explanatory hint — only one follow-up is allowed at a time.
7. If Gemini's main composer already has draft text, the inline composer refuses to submit (no clobbering) with a hint to clear it first.
8. If the user toggles inline mode off (or navigates to a different chat) while a follow-up is mid-stream, `abortAllInFlight` un-hides the claimed turn so the response finishes rendering as a normal turn at page bottom — no work lost.
9. On error (send button never enables, main composer occupied, concurrent submit), the placeholder shows the error message and a **Retry** button.

Persistence across reload, recursive nested sub-lists on the answered follow-up itself, and HTML sanitization beyond Shadow DOM isolation are out of scope and land in later phases.

---

## File map (what's new in Phase 4)

```
src/
├── content-script.tsx                Updated — adds childList observer on scroll container; abort on toggle-off
├── routing/                          NEW namespace — all hijack + claim + mirror lives here
│   ├── composer-bridge.ts            NEW — buildPrompt(), mainComposerHasDraft(), submitToGeminiComposer()
│   ├── response-claimer.ts           NEW — single-slot pending model (startPending/tryClaim/abort) + pub/sub
│   ├── stream-mirror.ts              NEW — hides claimed turn, mirrors innerHTML, detects completion
│   └── index.ts                      NEW — submitFollowup() pipeline, onNewTurn(), abortAllInFlight()
├── state/
│   └── followups-state.ts            Updated — extended status union, answerHtml/errorMessage, update()/getById()
├── ui/
│   ├── InlineComposer.tsx            Updated — calls routing.submitFollowup; disables Ask while pending
│   └── PendingFollowup.tsx           Updated — branches on status; renders streamed HTML; error+retry
└── styles/
    └── pending-followup.css          Updated — answer body, streaming pulse, error+retry styling
```

---

## Build & load

```sh
npm run build
```

Or for live-reload during development:

```sh
npm run dev
```

Reload `dist/` at `chrome://extensions` (or click the circular-arrow icon on the card if already loaded), then refresh any open Gemini tabs.

For Phase 4 verification, you want a chat with at least **two completed responses** containing some structural variety. A good seed prompt for the first response:

> Explain CSS grid in 3 paragraphs, include a small code example, and finish with 3 common gotchas as a bullet list.

Send a second small prompt after that ("Thanks!") so you have multiple turns to choose anchor blocks from.

---

## Check 1: single-block follow-up streams into the card

1. Enable inline mode (the bottom-right toggle).
2. Check the **first paragraph's** gutter checkbox.
3. In the inline composer, type a question like:
   > Can you give me one more concrete example of what this would look like in a real layout?
4. Press `Cmd/Ctrl+Enter` (or click **Ask**).

Expected:
- A "Pending answer…" card appears beneath the paragraph almost immediately.
- The page does **not** scroll to the bottom. Your viewport stays put.
- A new turn does **not** visually appear at page bottom (verify by scrolling down — nothing new).
- Within a second or two, the card's body begins streaming Gemini's answer in real time, replacing "Pending answer…". A small blue pulsing dot (●) appears in the top-right corner of the answer area while streaming.
- When the stream completes, the pulsing dot disappears and the answer settles.

If the card stays on "Pending answer…" forever, see Troubleshooting below — the most likely culprit is the send-button-ready poll timing out (status flips to `'error'`).

---

## Check 2: multi-block follow-up uses a multi-blockquote prompt

1. Check the **first paragraph's** box, the **code block's** box, and the **bullet list's** box (three quotes stacked in the composer).
2. Type a question:
   > Combining all three of these — paragraphs, code, and gotchas — what's the single most important thing to remember?
3. Submit.

Expected:
- The card appears beneath the bullet list (the bottom-most checked block in DOM order — the anchor).
- All three quotes appear stacked at the top of the card.
- The answer streams in.

To verify Gemini actually received a multi-blockquote prompt, open DevTools and run:

```js
// Find the hidden turn (the one we claimed) and un-hide it to inspect what Gemini "saw".
const hidden = document.querySelector('[data-ilui-claimed]');
hidden.style.display = '';
// Scroll down — you should see the synthetic user-turn echoing our injected prompt
// with three blockquote regions followed by the question.
// Re-hide it before continuing:
hidden.style.display = 'none';
```

---

## Check 3: second submit is blocked while one is in flight

1. Start a long follow-up (e.g. "Explain in detail with 5 worked examples…"). Submit.
2. While the answer is still streaming into the card, check another block and try to type a second question.

Expected:
- The **Ask** button is disabled.
- The hint text in the composer reads "Another follow-up is in flight. Wait for it to finish."
- Pressing `Cmd/Ctrl+Enter` does nothing.
- Once the first follow-up's status flips to `'done'` (streaming pulse disappears), the **Ask** button re-enables and the hint reverts.

---

## Check 4: refuses if Gemini's main composer is occupied

1. Type any text into Gemini's main composer at the bottom of the page (don't send it).
2. Check a block, type a question in the inline composer.

Expected:
- The **Ask** button is disabled.
- The hint reads "Clear the main Gemini composer first."
- Clear Gemini's main composer. The hint reverts and Ask re-enables.

This guards against silently clobbering the user's in-progress message.

---

## Check 5: scroll position is held during claim + stream

1. Scroll up so a prior response is fully in view, with significant space above and below it.
2. Note the viewport — pick a specific line of text near the bottom of your viewport.
3. Check a block on the prior response and submit a follow-up.

Expected:
- Your viewport does **not** jump. The line you noted stays at roughly the same vertical position.
- The card streams beneath the checked block, where you can see it without scrolling.

If the viewport snaps to the page bottom, the scroll-restoration loop in [stream-mirror.ts](src/routing/stream-mirror.ts) isn't winning the race against Gemini's auto-scroll. Increase `restoreFrames` from 6 to 12 and rebuild.

---

## Check 6: toggle-off mid-stream un-hides the turn

1. Start a follow-up that produces a long answer. Submit.
2. **While the answer is still streaming** (pulse still active), click the inline-mode toggle at the bottom-right to turn it off.

Expected:
- The inline UI (checkboxes, composer, follow-up cards) all disappear immediately.
- The hidden turn **un-hides itself** — you should now see the response appearing at the page bottom as a normal Gemini turn, continuing to stream until it finishes.
- No console errors.

This is the graceful-degradation path: the response Gemini already paid for isn't thrown away just because the user changed their mind about inline mode.

---

## Check 7: navigation mid-stream un-hides the turn

1. Start another long follow-up. Submit.
2. While streaming, click a different chat in Gemini's left sidebar.

Expected:
- The 300ms URL poller in [content-script.tsx:376](src/content-script.tsx#L376) flips inline mode off automatically.
- Same behavior as Check 6: the inline UI tears down, the hidden turn un-hides in the **original** chat. If you navigate back, the response is there as a normal turn.

---

## Check 8: error path + retry

To force the error path:

1. Send a real prompt in Gemini's main composer (e.g. "Hi"). While Gemini is **mid-response** to that one (send button is still showing the stop icon), enable inline mode, check a block, type a question, and try to submit.
2. The send button can't be claimed (Gemini's own response is using the composer), so the poll in `waitForSendReady` will time out after ~800 ms.

Expected:
- The card status flips to `'error'`.
- The card body shows a red error message: "Couldn't submit to Gemini (send button never enabled)." plus a **Retry** button.
- Clicking **Retry** (once Gemini's own response has finished) resubmits the follow-up successfully.

You can also force an error by manually disabling the send button:

```js
// Run before clicking Ask:
document.querySelector('button.send-button').setAttribute('aria-disabled', 'true');
```

---

## Check 9: normal Gemini messaging still works

1. Disable inline mode.
2. Send a normal message in Gemini's main composer.

Expected: works exactly as it always did — the response renders at page bottom, the collapse header (Phase 2) is injected, no leftover hidden turns from prior inline mode sessions, no console errors.

Also verify with inline mode **enabled**:

3. Enable inline mode (no follow-up in flight).
4. Send a normal message in Gemini's main composer.

Expected: same as above. The follow-up claim slot is empty so `tryClaim()` returns `null` on the new turn — the turn is **not** hijacked, it renders normally, and Phase 2 + Phase 3 processing (collapse header + block checkboxes) still apply once it completes.

---

## Check 10: hard reload drops follow-up cards (correct for Phase 4)

1. Submit a couple of follow-ups; let them finish.
2. Hard reload the page.

Expected:
- The original Gemini conversation is intact (since the turns that ran the synthetic prompts are part of Gemini's real history — they'll re-hydrate as visible turns at page bottom on reload).
- The follow-up **cards** are gone — they were transient in-memory state.
- The Phase 2 collapse headers re-appear on every response, including the synthetic ones that produced our hidden turns.

Persistence (so the cards survive reload, anchored back to their parent blocks) is Phase 5's job. Phase 4's "no persistence" is the correct behavior.

---

## Spot-check: inspect the routing pipeline in DevTools

Open the Console after a submit. You should see the existing log:

```
[InlineUI] submit { id: "fu-1", status: "pending", anchorBlockId: "...", referencedBlocks: [...], question: "..." }
```

Then inspect live state:

```js
// Followups state — look at the keyed-by-anchor map. (Module is a singleton.)
// There's no exported getAll(), so easiest: pick a known card and read via DevTools-injected logging
// or just inspect the .ilui-followup-host elements:
document.querySelectorAll('.ilui-followup-host[data-anchor]').length

// Claimed (hidden) turns:
document.querySelectorAll('[data-ilui-claimed]').length

// The data-ilui-claimed value is the followupId that owns the hidden turn.
document.querySelector('[data-ilui-claimed]')?.getAttribute('data-ilui-claimed')
```

While a follow-up is streaming, `document.querySelector('[data-ilui-claimed]')` should return a hidden `.conversation-container`. Once status flips to `'done'`, the turn stays hidden (so the answer only lives in the card), but the mirror observer disconnects.

---

## Forcing a failure: break the composer hijack

To confirm error handling on a real failure path:

1. In [src/routing/composer-bridge.ts](src/routing/composer-bridge.ts), change `getComposerInput` to a selector that doesn't exist — e.g. `document.querySelector('rich-textarea .ql-editor[data-fake="true"]')`.
2. Rebuild and reload.
3. Try to submit a follow-up.

Expected: `submitToGeminiComposer` returns `false` immediately, `submitFollowup` flips the followup to `'error'` with "Couldn't submit to Gemini (send button never enabled)." (or, if you also broke send-button selectors, a more specific message — feel free to add granularity here). Revert the change.

To confirm the claim path on the new-turn observer:

1. In [src/routing/response-claimer.ts](src/routing/response-claimer.ts), change `tryClaim` to always return `null`.
2. Rebuild and reload.
3. Submit a follow-up.

Expected: Gemini's response will appear at page bottom as a normal turn (no claim, no hide), and the follow-up card will hang at "Pending answer…" forever. Revert.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Card hangs on "Pending answer…" indefinitely | `submitToGeminiComposer` returned false but status was never updated, OR `tryClaim` never matched the new turn | Check Console for `[InlineUI] submit` followed by no status updates. Add a `console.log` in [routing/index.ts](src/routing/index.ts) after each `updateFollowup` call to trace |
| Card immediately shows "Couldn't submit to Gemini (send button never enabled)" | `InputEvent` dispatch didn't make Gemini's Angular state recognize the new content, so `aria-disabled` stayed `"true"` on the send button | Try increasing the `waitForSendReady` timeout from 800 ms. If still failing, the dispatch shape may need a `keydown`+`keyup` pair before the `InputEvent` |
| Card shows "Another follow-up is in flight" even though nothing is streaming | `responseClaimer` never got `abort()` or successful `tryClaim()` after a previous submit — stuck pending slot | Open Console, eval the module's state by clicking around; quickest reset is to toggle inline mode off (calls `abortAllInFlight`) then back on |
| Page scrolls to bottom on submit despite scroll-restore loop | Gemini's auto-scroll fires more frames than `restoreFrames=6` covers | Increase `restoreFrames` to 12 in [stream-mirror.ts](src/routing/stream-mirror.ts) |
| Hidden turn becomes visible later as user scrolls | We hid the turn but Gemini re-rendered its `display` style in a later tick | Strengthen the hide: set `visibility: hidden` + `position: absolute` in addition to `display: none`, or set the style with `!important` via a class |
| Answer renders but looks unstyled (raw HTML) | Shadow root inherits no Gemini styles; the markdown elements in `dangerouslySetInnerHTML` need our own in-shadow styling | Extend [pending-followup.css](src/styles/pending-followup.css) with rules for the markdown elements (`.ilui-followup-answer h1`, `.ilui-followup-answer table`, etc) |
| Retry button does nothing | The retry handler re-calls `submitFollowup` but the followup is still `'error'` — and `submitFollowup` doesn't reset status before retrying | The `submitFollowup` pipeline transitions through `pending → submitted → streaming → done`; on retry from `'error'`, it should still flow. Add a `updateFollowup(id, { status: 'pending', errorMessage: null })` at the top of `submitFollowup` if needed |
| Streaming pulse never disappears | `isResponseComplete` returned false even after Gemini stopped streaming | Inspect the hidden `.markdown-main-panel`: confirm `aria-busy` flipped to `"false"`. If Gemini stopped setting it, fall back to "no aria-busy attribute + has rendered children → done" logic already in [gemini-dom.ts:168](src/gemini-dom.ts#L168) |

---

## Out of scope for Phase 4

- Persisting follow-up cards across reload (Phase 5).
- Hash-collision / orphan handling when Gemini regenerates a response (Phase 5).
- Recursive "Ask about this" on a follow-up's *own* answer (Phase 4.5 / 5).
- HTML sanitization beyond Shadow DOM isolation (Phase 6).
- Onboarding tooltip for the new submit → stream flow (Phase 6).
- Queueing multiple in-flight follow-ups (deferred — current rule is one-at-a-time).
- Auto-cancelling a hijacked send if the user starts typing in the main composer mid-stream (deferred).
