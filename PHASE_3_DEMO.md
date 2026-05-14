# Phase 3 — Demo & Verification

Phase 3 ships **block detection and a checkbox-referenced composer**. Each completed model response is parsed into blocks; every block gets a small always-visible checkbox in its left gutter. Checking one or more blocks opens a single shared inline composer anchored beneath the most-recently-checked block; submitting renders a "Pending answer…" sub-list card beneath the anchor.

What Phase 3 delivers:

1. Every completed model response is parsed. Each renderable block (`<p>`, `<pre>`, `<ul>`/`<ol>`, `<h1>`–`<h6>`, `<table>`) is stamped with a stable `data-ilui-block-id` attribute.
2. A small checkbox appears in the left gutter of each block, always visible.
3. Checking a block opens an inline composer as the next DOM sibling of that block, showing the block's text as a stacked quote preview at the top of the composer.
4. Checking additional blocks adds them as stacked quotes and moves the composer to the newly-checked block (the new anchor). The textarea draft is preserved across moves.
5. Unchecking the anchor moves the composer to the next-most-recent checked block; unchecking the last one closes the composer.
6. Submitting (Ask button or `Cmd/Ctrl+Enter`) renders a "Pending answer…" sub-list card beneath the anchor block, showing every referenced quote plus the user's question. The composer closes and all checkboxes clear.
7. Multiple submissions on the same anchor stack as separate cards.

Sending the questions to Gemini and streaming real answers land in Phase 4. Persistence across reload lands in Phase 5.

---

## File map (what's new in Phase 3)

```
src/
├── content-script.tsx              Updated — onTurnComplete now also parses blocks + injects checkboxes
├── gemini-dom.ts                   Updated — added getResponseBody()
├── blocks/
│   ├── block-parser.ts            NEW — parseBlocks() walks .markdown-main-panel, stamps data-ilui-block-id
│   └── block-cache.ts             NEW — turnId → Block[] lookup + getQuotePreview()
├── state/
│   ├── checked-blocks-state.ts    NEW — multi-select state + anchor tracking
│   ├── composer-state.ts          NEW — single composer instance, follows anchor, preserves draft
│   └── followups-state.ts         NEW — placeholder sub-list state
├── ui/
│   ├── BlockCheckbox.tsx          NEW — gutter checkbox component
│   ├── InlineComposer.tsx         NEW — stacked quotes + textarea + Ask/Cancel
│   └── PendingFollowup.tsx        NEW — placeholder sub-list card
└── styles/
    ├── block-checkbox.css         NEW
    ├── inline-composer.css        NEW
    └── pending-followup.css       NEW
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

For Phase 3 verification, send a prompt that produces structural variety. A good seed prompt:

> Explain CSS grid in 3 paragraphs, include a small code example, and finish with 3 common gotchas as a bullet list.

That gives you 3 `<p>` blocks, one `<pre>` block, and one `<ul>` block — enough to exercise every check below.

---

## Check 1: blocks are parsed and stamped

After the response finishes streaming, open DevTools Console:

```js
// Count blocks stamped with our id attribute.
document.querySelectorAll('[data-ilui-block-id]').length

// Inspect the first one — should have data-ilui-block-id and inline position:relative.
document.querySelector('[data-ilui-block-id]')

// Spot-check structural variety.
document.querySelectorAll('pre[data-ilui-block-id], ul[data-ilui-block-id]').length
```

Expected:
- `.length` matches the visible block count for the response (5 for the seed prompt above).
- Each matched element is a `<p>`, `<pre>`, `<ul>`, `<ol>`, `<h*>`, or `<table>` — never a `<div>` or `<bard-avatar>`.
- Each element has `style="position: relative"` set inline (this is what lets the gutter checkbox sit in negative-margin space without disrupting Gemini's layout).

If `.length` is `0`, the canary likely failed (`ok: false` in the console). Fix the broken selector in `src/gemini-dom.ts` before continuing.

---

## Check 2: gutter checkboxes appear

1. Look at the left edge of each block in a completed response. You should see a small square checkbox in the gutter (roughly 24 px wide, just outside the block's left margin).
2. The checkboxes should be visible at all times — no hover required.
3. Code blocks (`<pre>`) and lists (`<ul>`) should also have their own gutter checkbox.

Inspect in Elements panel — you should see a `<div class="ilui-checkbox-host">` injected as the first child of each block, with its own shadow root.

---

## Check 3: single-check opens the composer beneath the block

1. Click the checkbox next to the **first paragraph**.
2. An inline composer should appear as the next DOM sibling of that paragraph (above the next paragraph). The composer contains:
   - A stacked quote row showing the paragraph's text (truncated to ~120 chars with `…`).
   - A textarea labeled "Ask about this…" or similar.
   - An "Ask" button and a "Cancel" button.
3. Clicking the paragraph's checkbox again **unchecks** it and removes the composer.

---

## Check 4: multi-check moves the anchor

1. Check the first paragraph's box — composer appears beneath the paragraph.
2. Check the **code block's** box.
3. The composer should **move** so it now sits beneath the code block (the new most-recently-checked block).
4. The quote area should now show **two** stacked previews: paragraph first, code block second.
5. Check the bullet list's box — composer moves again, now beneath the list, showing three stacked quotes.

---

## Check 5: unchecking the anchor moves the composer to the next-most-recent

1. Continuing from Check 4, with three blocks checked (composer below the list):
2. Uncheck the list. Composer should move back beneath the **code block** (now the most-recent of the remaining checked blocks). Two quotes remain.
3. Uncheck the code block. Composer moves to the **paragraph**. One quote remains.
4. Uncheck the paragraph. Composer disappears entirely.

---

## Check 6: textarea draft survives anchor moves

1. Check the first paragraph. Type "What does this mean for nested grids?" into the textarea.
2. Without submitting, check the code block. Composer moves; the textarea should still contain your draft.
3. Uncheck the paragraph. Composer is now beneath the code block only, draft still intact.
4. Check the paragraph again. Composer moves back; draft preserved.

If the draft is lost during a move, `composer-state.ts` is re-mounting the component without rehydrating from its in-memory draft — fix the rehydration path before continuing.

---

## Check 7: submission creates a placeholder sub-list card

1. With one or more blocks checked and a question in the textarea, press `Cmd/Ctrl+Enter` (or click **Ask**).
2. The composer should disappear.
3. A card labeled with "Pending answer…" appears as the next sibling of the anchor block. The card shows:
   - Every referenced quote (stacked at top).
   - The user's question.
   - An italicized "Pending answer…" body (this is where Phase 4 will stream the real response).
4. All gutter checkboxes should clear back to unchecked.

Open the Console — the submit handler should also log the payload:

```js
[InlineUI] submit { anchorBlockId: "abcd1234-2", referencedBlocks: [...], question: "..." }
```

This is exactly the payload Phase 4's composer-bridge will consume.

---

## Check 8: multiple submissions stack under the same anchor

1. Check the first paragraph and submit a question. Placeholder card appears beneath it.
2. Check the same paragraph again, type a different question, submit.
3. The second placeholder should appear **below** the first — both cards visible, stacked, neither overwriting the other.

---

## Check 9: style isolation

Inspect the composer or a placeholder card in DevTools → Elements. Structure should look like:

```html
<div class="ilui-composer-host">
  #shadow-root (open)
    <style>…inline-composer.css…</style>
    <div class="ilui-composer">
      <div class="ilui-quotes">…stacked quotes…</div>
      <textarea class="ilui-composer-textarea">…</textarea>
      <div class="ilui-composer-actions">
        <button class="ilui-composer-cancel">Cancel</button>
        <button class="ilui-composer-submit">Ask</button>
      </div>
    </div>
</div>
```

The shadow root keeps Gemini's stylesheet out and our styles in. The same pattern applies to `.ilui-checkbox-host` and `.ilui-followup-host`.

---

## Forcing a failure: break block detection

To confirm the canary banner still surfaces a regression here:

1. In `src/gemini-dom.ts`, change `getResponseBody` to `return null`.
2. Rebuild and reload. New completed responses should produce **zero** blocks; checkboxes won't appear. The Console should not crash — the parser silently bails when the body isn't found.
3. Revert the change.

To confirm checkbox positioning doesn't break Gemini's layout:

1. Temporarily remove the `el.style.position = 'relative'` line in `block-parser.ts`.
2. Rebuild, reload, send a new prompt. The checkboxes should now visually misalign or overlap content (no anchor for their absolute positioning).
3. Revert. Confirm the layout snaps back.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No checkboxes appear | Block parsing didn't run — canary failed or `getResponseBody` returned null | Check `[InlineUI] canary:` in Console; verify `.markdown-main-panel` still exists inside `<model-response>` |
| Checkboxes appear but misaligned | Block element lost its `position: relative` (e.g., Gemini's own inline style overrode it) | Inspect the block in Elements; check that `style` includes `position: relative`; if not, parser is racing Gemini's render |
| Composer appears at page bottom instead of beneath the block | `composer-state` failed to find the anchor block; defaulted to body append | Verify `document.querySelector('[data-ilui-block-id="<id>"]')` returns the element; check the host insertion code |
| Draft lost when anchor moves | InlineComposer reads from local state instead of `composer-state.getDraft()` | The composer must be a controlled component reading the draft from state, not from a `useState` that resets on remount |
| Two placeholders rendered for one submission | `followups-state` keyed incorrectly, or component subscribed twice | Each `PendingFollowup` host should subscribe once; verify its cleanup function disconnects on unmount |
| Checkbox click toggles two blocks | Block ids collided (content hash + ordinal not unique) | Confirm `parseBlocks` increments `ordinal` for every match — including duplicate paragraphs |
| Composer doesn't close after submit | `checked-blocks-state.clear()` not called in submit handler | Inspect `InlineComposer.tsx` submit path — must clear checked state, which closes the composer reactively |

---

## Out of scope for Phase 3

- Sending the question to Gemini's real composer (Phase 4).
- Streaming a real answer into the placeholder card (Phase 4).
- Persisting checked state, drafts, or placeholders across reload (Phase 5).
- Recursive nested sub-lists inside an answered follow-up (Phase 4 / 5).
- Re-parsing blocks when Gemini regenerates a response (Phase 5 orphan handling).
- Onboarding tooltip explaining the checkbox gesture (Phase 6).
