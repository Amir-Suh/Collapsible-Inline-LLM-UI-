import { useState, useEffect, useRef } from 'preact/hooks';
import {
  getChecked,
  toggle,
  clear as clearChecked,
  getAnchorBlockId,
  subscribe as subscribeChecked,
} from '../state/checked-blocks-state';
import {
  getDraft,
  setDraft,
  clearDraft,
  subscribe as subscribeDraft,
} from '../state/composer-state';
import {
  add as addFollowup,
  isAnyStreaming,
  subscribe as subscribeFollowups,
} from '../state/followups-state';
import { submitFollowup } from '../routing';
import { hasPending, subscribe as subscribePending } from '../routing/response-claimer';
import { mainComposerHasDraft } from '../routing/composer-bridge';

export function InlineComposer() {
  const [, force] = useState({});
  const [text, setText] = useState(getDraft());
  const [pending, setPending] = useState(hasPending());
  const [streaming, setStreaming] = useState(isAnyStreaming());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const unsubChecked = subscribeChecked(() => force({}));
    const unsubDraft = subscribeDraft(() => setText(getDraft()));
    const unsubPending = subscribePending(() => setPending(hasPending()));
    const unsubFollowups = subscribeFollowups(() => setStreaming(isAnyStreaming()));
    return () => {
      unsubChecked();
      unsubDraft();
      unsubPending();
      unsubFollowups();
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const quotes = getChecked();
  const mainOccupied = mainComposerHasDraft();
  const disabled = !text.trim() || pending || mainOccupied || streaming;

  function submit(): void {
    const question = text.trim();
    if (!question) return;
    if (pending || mainOccupied || streaming) return;
    const anchor = getAnchorBlockId();
    if (!anchor) return;

    const followup = addFollowup({
      anchorBlockId: anchor,
      referencedBlocks: quotes,
      question,
    });

    clearDraft();
    clearChecked();

    void submitFollowup(followup);
  }

  function cancel(): void {
    clearDraft();
    clearChecked();
  }

  function handleInput(e: Event): void {
    const next = (e.target as HTMLTextAreaElement).value;
    setText(next);
    setDraft(next);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  const hint = streaming
    ? 'Wait for the current response to finish.'
    : pending
      ? 'Another follow-up is in flight. Wait for it to finish.'
      : mainOccupied
        ? 'Clear the main Gemini composer first.'
        : '⌘/Ctrl + Enter to send · Esc to cancel';

  return (
    <div class="ilui-composer">
      <div class="ilui-quotes">
        {quotes.map(q => (
          <div class="ilui-quote" key={q.blockId}>
            <button
              class="ilui-quote-remove"
              onClick={() => toggle(q.blockId, q.turnId, q.quotedText)}
              aria-label="Remove this reference"
            >
              ×
            </button>
            <span class="ilui-quote-text">{q.quotedText}</span>
          </div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        class="ilui-composer-textarea"
        value={text}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Ask about the referenced block(s)…"
        rows={3}
      />
      <div class="ilui-composer-actions">
        <span class="ilui-composer-hint">{hint}</span>
        <button class="ilui-composer-cancel" onClick={cancel}>
          Cancel
        </button>
        <button class="ilui-composer-submit" onClick={submit} disabled={disabled}>
          Ask
        </button>
      </div>
    </div>
  );
}
