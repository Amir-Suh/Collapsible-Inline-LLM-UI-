import type { Followup } from '../state/followups-state';
import { update as updateFollowup, isAnyStreaming } from '../state/followups-state';
import {
  buildPrompt,
  mainComposerHasDraft,
  submitToGeminiComposer,
} from './composer-bridge';
import {
  startPending,
  hasPending,
  abort as abortClaimer,
} from './response-claimer';
import { start as startMirror, type MirrorHandle } from './stream-mirror';
import type { Claim } from './response-claimer';

const activeMirrors = new Map<string, MirrorHandle>();

/**
 * Pipeline: build prompt → claim slot → inject into Gemini composer → click
 * send. Updates the followup's status as the pipeline progresses; on any
 * failure, sets status='error' with a message.
 */
export async function submitFollowup(followup: Followup): Promise<void> {
  if (hasPending()) {
    updateFollowup(followup.id, {
      status: 'error',
      errorMessage: 'Another follow-up is in flight. Wait for it to finish.',
    });
    return;
  }
  if (mainComposerHasDraft()) {
    updateFollowup(followup.id, {
      status: 'error',
      errorMessage: 'Clear the main Gemini composer before sending a follow-up.',
    });
    return;
  }

  if (isAnyStreaming()) {
    updateFollowup(followup.id, {
      status: 'error',
      errorMessage: 'Wait for the current response to finish before sending another follow-up.',
    });
    return;
  }

  const prompt = buildPrompt(followup.referencedBlocks, followup.question);
  startPending(followup.id);

  const ok = await submitToGeminiComposer(prompt);
  if (!ok) {
    abortClaimer();
    updateFollowup(followup.id, {
      status: 'error',
      errorMessage: "Couldn't submit to Gemini (send button never enabled).",
    });
    return;
  }

  updateFollowup(followup.id, { status: 'submitted', errorMessage: null });
}

/**
 * Called from content-script's new-turn observer. Tries to claim and start
 * mirroring; returns true if claimed.
 */
export function onNewTurn(tryClaim: () => Claim | null): boolean {
  const claim = tryClaim();
  if (!claim) return false;
  const handle = startMirror(
    claim.turnEl,
    claim.followupId,
    claim.scrollTopSnapshot,
    () => activeMirrors.delete(claim.followupId),
  );
  activeMirrors.set(claim.followupId, handle);
  return true;
}

/**
 * Abort everything in flight: drop the pending claim slot, un-hide any
 * actively-mirrored turn so its response renders normally at the page bottom,
 * and stop the mirror observers. Followup records stay in state (their cards
 * are torn down separately by `disableInlineMode`).
 */
export function abortAllInFlight(): void {
  abortClaimer();
  for (const handle of activeMirrors.values()) {
    handle.unhide();
  }
  activeMirrors.clear();
}
