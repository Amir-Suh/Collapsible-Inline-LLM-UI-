# Phase 2 — Demo & Verification

Phase 2 ships **collapsible responses**. Every Gemini model response gets a header bar with a chevron toggle; clicking it hides or shows the response body. Collapse state persists across page reloads via `chrome.storage.local`.

What Phase 2 delivers:

1. A header bar (chevron + summary) injected above each completed model response.
2. Click-to-collapse/expand — no auto-collapse, responses only hide when you explicitly click.
3. `Ctrl+[` collapses the most recent response; `Ctrl+]` expands all.
4. Collapse state persists: reload the page and each response stays as you left it.

Block parsing, inline selection, and composer hijack all land in Phase 3+.

---

## File map (what's new in Phase 2)

```
src/
├── content-script.tsx          Updated — wires observer, injects headers, registers shortcuts
├── gemini-dom.ts               Updated — added getResponseSummary()
├── observers/
│   └── response-observer.ts   NEW — fires callback when a model turn finishes streaming
├── state/
│   └── collapse-state.ts      NEW — pub-sub state + chrome.storage.local sync
└── ui/
│   └── CollapsibleHeader.tsx  NEW — chevron + summary component
└── styles/
    └── collapse-header.css    NEW — header bar styles (scoped to each header's shadow root)
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

Load `dist/` as an unpacked extension in `chrome://extensions` (Developer mode → Load unpacked). Reload any open Gemini tabs after rebuilding.

---

## Check 1: header bars appear

1. Open `https://gemini.google.com` and open a conversation that already has at least one response (or send a prompt and wait for the reply to finish streaming).
2. Above each completed model response you should see a slim header bar containing:
   - A `▼` chevron on the left.
   - The first ~80 characters of the response as grey summary text.

If no header bars appear, open DevTools Console and look for `[InlineUI] canary:`. If `ok` is `false`, a required selector broke — fix it in `src/gemini-dom.ts` before continuing (same process as Phase 1).

---

## Check 2: collapse and expand

1. Click the `▼` chevron on any response. The response body should disappear and the chevron should change to `▶`.
2. Click `▶` again. The body reappears and the chevron returns to `▼`.
3. Confirm the page does **not** scroll when you toggle — the viewport position should stay fixed.

---

## Check 3: no auto-collapse on new turn

1. Expand all responses (they start expanded by default).
2. Send a new prompt and wait for Gemini to finish replying.
3. All previously expanded responses should **remain expanded**. Only the new response gets a header bar added.

---

## Check 4: keyboard shortcuts

| Shortcut | Expected behaviour |
|---|---|
| `Ctrl+[` (or `Cmd+[` on Mac) | Collapses the most recently completed response. |
| `Ctrl+]` (or `Cmd+]` on Mac) | Expands every response in the conversation. |

If the shortcut does nothing, confirm focus is on the page (click anywhere on the Gemini page first, not in the DevTools panel).

---

## Check 5: persistence across reload

1. Collapse one or more responses by clicking their chevrons.
2. Hard-reload the page (`Ctrl+Shift+R`).
3. The same responses should be collapsed immediately after the page loads — no flash of expanded content.

To verify storage directly, open DevTools → Application → Storage → Extension storage → `chrome.storage.local`. You should see a key of the form `conv:<conversationId>:collapse` holding an object like:

```json
{ "turn-abc123": "collapsed", "turn-def456": "expanded" }
```

---

## Check 6: style isolation

Open DevTools → Elements and inspect one of the injected header bars. The structure should look like:

```html
<div class="ilui-header-host">
  #shadow-root (open)
    <style>…collapse-header.css…</style>
    <div>
      <div class="ilui-header">
        <button class="ilui-chevron">▼</button>
        <span class="ilui-summary">First 80 chars of the response…</span>
      </div>
    </div>
</div>
```

The `ilui-header-host` element sits immediately before the `model-response` element in Gemini's DOM. The shadow root keeps Gemini's stylesheet out and our styles in.

---

## Forcing a failure: broken streaming signal

To confirm the observer falls back correctly if `aria-busy` is absent:

1. In `src/gemini-dom.ts`, change `isResponseComplete` to always return `false`.
2. Build and reload. No header bars should appear on new responses (existing ones from the DOM-walk path on page load will still appear since that path also calls `isResponseComplete`).
3. Revert the change.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No header bars on any response | Canary failed (`ok: false`) or content script didn't run | Check Console for `[InlineUI] canary:` line; fix selector in `src/gemini-dom.ts` |
| Header appears but response doesn't hide on click | `getModelResponse()` returned wrong element — header is attached to a different parent | Inspect the `ilui-header-host` position in Elements; verify it's a sibling of `model-response` |
| Collapse state not persisting | `parseConversationId` returned `null` (happens on `/app` with no ID) | Only test persistence on a named conversation URL (`/app/<id>`) |
| Scroll jumps when collapsing | The scroll container selector changed | Check `getChatScrollContainer()` in `content-script.tsx` still resolves |
| Keyboard shortcut does nothing | Page focus is in DevTools or the composer | Click anywhere on the Gemini page body first |

---

## Out of scope for Phase 2

- Block parsing (identifying paragraphs, code fences, headings within a response)
- "Ask about this" selection affordance
- Inline composer and sub-list rendering
- Composer hijack
- Nested follow-up Q&A
