import { useState, useEffect } from 'preact/hooks';
import { getTurnState, toggleTurn, subscribe } from '../state/collapse-state';

type Props = {
  turnId: string;
  summary: string;
  modelResponseEl: HTMLElement;
  scrollContainer: Element | null;
};

export function CollapsibleHeader({ turnId, summary, modelResponseEl, scrollContainer }: Props) {
  const [collapsed, setCollapsed] = useState(getTurnState(turnId) === 'collapsed');

  // Apply initial display state on mount.
  useEffect(() => {
    modelResponseEl.style.display = collapsed ? 'none' : '';
  }, []);

  // Subscribe to external state changes (e.g. Ctrl+] expand all).
  useEffect(() => {
    return subscribe(() => {
      const next = getTurnState(turnId) === 'collapsed';
      setCollapsed(next);
      modelResponseEl.style.display = next ? 'none' : '';
    });
  }, [turnId]);

  function handleToggle() {
    const scrollTop = scrollContainer ? (scrollContainer as HTMLElement).scrollTop : 0;

    toggleTurn(turnId);
    const next = getTurnState(turnId) === 'collapsed';
    setCollapsed(next);
    modelResponseEl.style.display = next ? 'none' : '';

    // Restore scroll position to prevent viewport jump.
    if (scrollContainer) {
      (scrollContainer as HTMLElement).scrollTop = scrollTop;
    }
  }

  return (
    <div class="ilui-header">
      <button
        class="ilui-chevron"
        onClick={handleToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand response' : 'Collapse response'}
      >
        {collapsed ? '▶' : '▼'}
      </button>
      <span class="ilui-summary">{summary}</span>
    </div>
  );
}
