import { useState, useEffect } from 'preact/hooks';
import { getFor, subscribe } from '../state/followups-state';

type Props = { anchorBlockId: string };

export function PendingFollowup({ anchorBlockId }: Props) {
  const [followups, setFollowups] = useState(getFor(anchorBlockId));

  useEffect(() => {
    return subscribe(() => setFollowups(getFor(anchorBlockId)));
  }, [anchorBlockId]);

  if (followups.length === 0) return null;

  return (
    <div class="ilui-followups">
      {followups.map(f => (
        <div class="ilui-followup" key={f.id}>
          <div class="ilui-followup-quotes">
            {f.referencedBlocks.map(q => (
              <div class="ilui-followup-quote" key={q.blockId}>
                <span class="ilui-followup-quote-text">{q.quotedText}</span>
              </div>
            ))}
          </div>
          <div class="ilui-followup-question">
            <span class="ilui-followup-question-label">Q:</span> {f.question}
          </div>
          <div class="ilui-followup-pending">Pending answer…</div>
        </div>
      ))}
    </div>
  );
}
