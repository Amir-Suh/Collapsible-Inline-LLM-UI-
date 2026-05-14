import { useState, useEffect } from 'preact/hooks';
import { isEnabled, toggle, subscribe } from '../state/inline-mode-state';

export function InlineToggleButton() {
  const [enabled, setEnabled] = useState(isEnabled());

  useEffect(() => {
    return subscribe(() => setEnabled(isEnabled()));
  }, []);

  return (
    <button
      class={`ilui-toggle${enabled ? ' on' : ''}`}
      onClick={toggle}
      aria-pressed={enabled}
      title={enabled ? 'Inline mode is on (click to disable)' : 'Enable per-block inline questions'}
    >
      <span class="ilui-toggle-dot" />
      {enabled ? 'Inline on' : 'Enable inline'}
    </button>
  );
}
