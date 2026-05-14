import { useState, useEffect } from 'preact/hooks';
import { isChecked, toggle, subscribe } from '../state/checked-blocks-state';

type Props = {
  blockId: string;
  turnId: string;
  quotedText: string;
};

export function BlockCheckbox({ blockId, turnId, quotedText }: Props) {
  const [checked, setChecked] = useState(isChecked(blockId));

  useEffect(() => {
    return subscribe(() => setChecked(isChecked(blockId)));
  }, [blockId]);

  return (
    <button
      class={`ilui-block-checkbox${checked ? ' checked' : ''}`}
      onClick={() => toggle(blockId, turnId, quotedText)}
      aria-checked={checked}
      aria-label={checked ? 'Unreference this block' : 'Reference this block in a question'}
      role="checkbox"
    >
      {checked ? '✓' : ''}
    </button>
  );
}
