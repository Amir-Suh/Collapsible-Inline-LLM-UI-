import type { Block } from './block-parser';

const byTurn = new Map<string, Block[]>();
const byBlockId = new Map<string, Block>();

export function setBlocks(turnId: string, blocks: Block[]): void {
  // Drop previous entries for this turn so a re-parse doesn't leak stale ids.
  const prev = byTurn.get(turnId);
  if (prev) {
    for (const b of prev) byBlockId.delete(b.blockId);
  }
  byTurn.set(turnId, blocks);
  for (const b of blocks) byBlockId.set(b.blockId, b);
}

export function getBlocksForTurn(turnId: string): Block[] {
  return byTurn.get(turnId) ?? [];
}

export function getBlockById(blockId: string): Block | undefined {
  return byBlockId.get(blockId);
}

export function getQuotePreview(blockId: string, maxChars = 120): string {
  const block = byBlockId.get(blockId);
  if (!block) return '';
  const text = block.textContent;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}
