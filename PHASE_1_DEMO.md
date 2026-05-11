# Phase 1 — Demo & Verification

Phase 1 ships **scaffolding only**, no user-facing features yet. The goal is to prove:

1. The Chrome extension loads on `gemini.google.com`.
2. A Shadow-DOM-isolated Preact root mounts as `<div id="inline-ui-root">`.
3. The DOM canary reports which Gemini selectors resolve, so you know exactly which lines in `src/gemini-dom.ts` to update for Phase 2.

Collapsibles, sub-lists, and highlight-to-ask all land in Phase 2+ — do **not** expect to see them yet.

---

## File map (what each piece does)

```
Collapsible-Inline-LLM-UI-/
├── manifest.json              MV3 manifest, content script for gemini.google.com
├── vite.config.ts             Vite + CRXJS plugin + Preact
├── tsconfig.json              TS config (Preact JSX, strict)
├── package.json               deps: preact, vite, @crxjs/vite-plugin
├── src/
│   ├── content-script.tsx     Entry — mounts host div, attaches Shadow DOM, renders <Root/>
│   ├── gemini-dom.ts          The ONLY place Gemini selectors live + runCanary()
│   ├── ui/
│   │   ├── Root.tsx           Renders nothing when canary is ok; banner when not
│   │   └── CanaryBanner.tsx   Red banner top-right listing missing selectors
│   └── styles/
│       └── canary.css         Banner styles (loaded into the shadow root only)
└── PHASE_1_DEMO.md            This file
```

---

## Install & build

```sh
cd "Collapsible-Inline-LLM-UI-"
npm install
npm run build
```

The build emits an unpacked extension into `dist/`.

For iterative dev with live-reload (CRXJS HMR):
```sh
npm run dev
```
Then load `dist/` once and reload the Gemini tab after each save.

---

## Load in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` folder.
4. The extension should appear as **Collapsible Inline LLM UI**.

---

## Verify on a live page

Open `https://gemini.google.com/app` (sign in if needed), then open DevTools.

### Check 1: extension mounted

In the **Elements** panel, search (Ctrl+F) for `inline-ui-root`. You should see:

```html
<div id="inline-ui-root" style="all: initial; position: fixed; ...">
  #shadow-root (open)
    <style>…canary.css…</style>
    <div></div>   <!-- empty when canary passes; banner here when it fails -->
</div>
```

If `inline-ui-root` is not present, the content script did not run — check `chrome://extensions` for errors and confirm the host matches `https://gemini.google.com/*`.

### Check 2: canary in the console

The Console should print exactly one line right after page load:

```
[InlineUI] canary: { ok: true, checked: [...], conversationId: "…" }
```

Inspect the `checked` array. Each entry looks like:

```js
{ key: 'chatScrollContainer', description: '…', required: true, found: true }
```

### Check 3: banner behavior

- If `chatScrollContainer.found === false` → `ok` is `false` → a red banner appears top-right of the Gemini page (click **Details** to see which selectors missed).
- If `ok` is `true` but some optional selectors say `found: false` → no banner, but you still want to tighten those selectors before Phase 2 needs them.

---

## Decision matrix

| Canary result | Meaning | What to do |
|---|---|---|
| `ok: true`, every selector found | Selectors valid for current Gemini DOM. | Phase 1 complete — move to Phase 2. |
| `ok: true`, some optional selectors missing | Hard requirement passed but Phase 2/3/4 dependencies aren't located yet. | Inspect the live DOM, refine those selectors in `src/gemini-dom.ts`, rebuild. |
| `ok: false` | Required selector missing; banner visible. | Required is `chatScrollContainer`. Use DevTools to find Gemini's real chat scroller, update its `query()` in `src/gemini-dom.ts`, rebuild. |

---

## DOM reconnaissance checklist (Phase 1 deliverable)

For each item, paste the confirmed selector you found by inspecting the live Gemini DOM. These get committed back into `src/gemini-dom.ts` and become the foundation for Phase 2+.

- [ ] `chatScrollContainer` — confirmed selector: `__________`
- [ ] `conversationTurn` — confirmed selector: `__________`
- [ ] `modelResponse` — confirmed selector: `__________`
- [ ] `composerInput` — confirmed selector: `__________`
- [ ] `sendButton` — confirmed selector: `__________`
- [ ] Streaming-complete signal (attribute / class that toggles when Gemini finishes a response): `__________`
- [ ] Conversation ID location in URL (confirm `parseConversationId` handles it): `__________`

---

## Forcing a canary failure (sanity-test the banner)

Temporarily break one of the selectors to confirm the banner path works:

```ts
// src/gemini-dom.ts — chatScrollContainer entry
query: () => document.querySelector('#definitely-not-a-thing'),
```

Rebuild, reload the Gemini tab. You should see the red banner top-right with `chatScrollContainer (required) — …` flagged as failed. Revert the change before continuing.

---

## Out of scope for Phase 1

- Collapse / expand UI
- Block parsing
- Selection / "Ask about this" affordance
- Composer hijack
- chrome.storage persistence

Each of the above is gated on Phase 1 producing accurate selectors. Do the reconnaissance well — it's the cheap way to make every later phase reliable.
