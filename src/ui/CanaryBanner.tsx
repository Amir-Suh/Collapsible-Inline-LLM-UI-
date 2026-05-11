import { useState } from 'preact/hooks';
import type { CanaryResult } from '../gemini-dom';

export function CanaryBanner({ result }: { result: CanaryResult }) {
  const [open, setOpen] = useState(false);
  const failed = result.checked.filter(c => !c.found);

  return (
    <div class="canary">
      <div class="canary-row">
        <span class="canary-dot" />
        <span class="canary-msg">
          Inline UI is out of date — Gemini's interface changed ({failed.length} selector
          {failed.length === 1 ? '' : 's'} missing).
        </span>
        <button class="canary-toggle" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Details'}
        </button>
      </div>
      {open && (
        <ul class="canary-list">
          {result.checked.map(c => (
            <li class={c.found ? 'ok' : 'fail'}>
              <code>{c.key}</code>
              {c.required ? ' (required)' : ''} — {c.description}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
