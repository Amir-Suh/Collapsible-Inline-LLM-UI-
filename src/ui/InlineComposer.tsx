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
import { add as addFollowup } from '../state/followups-state';

export function InlineComposer() {
  const [, force] = useState({});
  const [text, setText] = useState(getDraft());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const unsubChecked = subscribeChecked(() => force({}));
    const unsubDraft = subscribeDraft(() => setText(getDraft()));
    return () => {
      unsubChecked();
      unsubDraft();
    };
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const quotes = getChecked();

  function submit(): void {
    const question = text.trim();
    if (!question) return;
    const anchor = getAnchorBlockId();
    if (!anchor) return;

    addFollowup({
      anchorBlockId: anchor,
      referencedBlocks: quotes,
      question,
    });

    clearDraft();
    clearChecked();
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
        <span class="ilui-composer-hint">⌘/Ctrl + Enter to send · Esc to cancel</span>
        <button class="ilui-composer-cancel" onClick={cancel}>
          Cancel
        </button>
        <button class="ilui-composer-submit" onClick={submit} disabled={!text.trim()}>
          Ask
        </button>
      </div>
    </div>
  );
}
