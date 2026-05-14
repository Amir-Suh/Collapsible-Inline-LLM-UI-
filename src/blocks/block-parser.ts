export type BlockTag = 'p' | 'pre' | 'list' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'table';

export type Block = {
  blockId: string;
  ordinal: number;
  tag: BlockTag;
  element: HTMLElement;
  textContent: string;
};

const BLOCK_TAGS: Record<string, BlockTag> = {
  P: 'p',
  PRE: 'pre',
  // Gemini wraps code blocks in a custom Angular element <response-element>
  // rather than emitting bare <pre>. Treat it as a 'pre' block.
  'RESPONSE-ELEMENT': 'pre',
  UL: 'list',
  OL: 'list',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  H5: 'h5',
  H6: 'h6',
  TABLE: 'table',
};

// djb2 hash. Tiny, fast, good enough for stable per-content IDs.
function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Walks the markdown panel's direct children, picks out renderable blocks,
 * stamps each with a stable `data-ilui-block-id`, and returns them.
 *
 * The id combines a content hash with the ordinal index so that two visually
 * identical paragraphs in the same response get distinct ids. We also flip
 * each block's inline `position` to `relative` so the gutter checkbox host
 * can be absolutely positioned against it without disrupting flow.
 */
export function parseBlocks(responseBodyEl: Element): Block[] {
  const blocks: Block[] = [];
  let ordinal = 0;

  for (const child of Array.from(responseBodyEl.children)) {
    const tag = BLOCK_TAGS[child.tagName];
    if (!tag) continue;

    const el = child as HTMLElement;
    const text = (el.textContent ?? '').trim();
    const blockId = `${hashString(text)}-${ordinal}`;

    el.setAttribute('data-ilui-block-id', blockId);
    if (!el.style.position) el.style.position = 'relative';

    blocks.push({
      blockId,
      ordinal,
      tag,
      element: el,
      textContent: text,
    });
    ordinal++;
  }

  return blocks;
}
