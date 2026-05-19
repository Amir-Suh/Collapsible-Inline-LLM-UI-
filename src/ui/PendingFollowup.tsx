import { useState, useEffect } from 'preact/hooks';
import { getFor, subscribe, type Followup } from '../state/followups-state';
import { submitFollowup } from '../routing';

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
          <AnswerBody f={f} />
        </div>
      ))}
    </div>
  );
}

function AnswerBody({ f }: { f: Followup }) {
  if (f.status === 'error') {
    return (
      <div class="ilui-followup-error">
        <span class="ilui-followup-error-msg">
          {f.errorMessage ?? 'Something went wrong.'}
        </span>
        <button class="ilui-followup-retry" onClick={() => void submitFollowup(f)}>
          Retry
        </button>
      </div>
    );
  }

  if (f.status === 'streaming' || f.status === 'done') {
    return (
      <div class="ilui-followup-answer-wrap">
        {f.status === 'streaming' && (
          <span class="ilui-followup-streaming-dot" aria-label="streaming">●</span>
        )}
        <div
          class="ilui-followup-answer"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: f.answerHtml ?? '' }}
        />
      </div>
    );
  }

  // 'pending' or 'submitted'
  return <div class="ilui-followup-pending">Pending answer…</div>;
}
