import type { CheckedBlock } from '../state/checked-blocks-state';
import {
  getComposerInput,
  getSendButton,
  isSendButtonReady,
} from '../gemini-dom';

/**
 * Build a Markdown-style prompt with each referenced block as a blockquote.
 * Multiple referenced blocks are separated by blank `>` lines so Gemini renders
 * them as visually distinct quoted regions in its own user-turn echo.
 */
export function buildPrompt(referencedBlocks: CheckedBlock[], question: string): string {
  const quotes = referencedBlocks.map(b =>
    b.quotedText
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n'),
  );
  const quoteBlock = quotes.join('\n>\n');
  return quoteBlock ? `${quoteBlock}\n\n${question}` : question;
}

/**
 * Whether the user has any draft text in Gemini's main composer. We refuse to
 * inject when this is true so we never clobber a real message in progress.
 */
export function mainComposerHasDraft(): boolean {
  const editor = getComposerInput();
  if (!editor) return false;
  return (editor.textContent ?? '').trim().length > 0;
}

/** Wait for the send button's aria-disabled to flip to a truthy-ready state. */
async function waitForSendReady(timeoutMs = 800): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (isSendButtonReady()) return true;
    await new Promise(r => requestAnimationFrame(() => r(undefined)));
  }
  return isSendButtonReady();
}

/**
 * Hijack Gemini's `.ql-editor` Quill contenteditable: focus it, replace its
 * contents with one `<p>` per line of the prompt, dispatch an `InputEvent` so
 * Angular's form binding picks up the change, wait for the send button to
 * enable, then click it.
 *
 * Returns true on successful click, false if the editor isn't available or the
 * send button never enables within the timeout.
 */
export async function submitToGeminiComposer(prompt: string): Promise<boolean> {
  if (isSendButtonReady()) return false;

  const editor = getComposerInput();
  if (!editor) return false;

  editor.focus();

  // Quill normalizes its document as a series of <p> elements. Build the same
  // shape directly: each prompt line becomes its own <p>. Empty lines become
  // <p><br></p> (Quill's canonical empty-paragraph form).
  const lines = prompt.split('\n');
  editor.innerHTML = lines
    .map(line => {
      if (line === '') return '<p><br></p>';
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<p>${escaped}</p>`;
    })
    .join('');

  editor.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }),
  );

  const ready = await waitForSendReady();
  if (!ready) return false;

  const sendBtn = getSendButton();
  if (!sendBtn) return false;
  sendBtn.click();
  return true;
}
