export type CheckedBlock = {
  blockId: string;
  turnId: string;
  quotedText: string;
  orderChecked: number;
};

const checked = new Map<string, CheckedBlock>();
const listeners = new Set<() => void>();
let orderCounter = 0;

function notify(): void {
  listeners.forEach(fn => fn());
}

export function toggle(blockId: string, turnId: string, quotedText: string): void {
  if (checked.has(blockId)) {
    checked.delete(blockId);
  } else {
    checked.set(blockId, {
      blockId,
      turnId,
      quotedText,
      orderChecked: ++orderCounter,
    });
  }
  notify();
}

export function isChecked(blockId: string): boolean {
  return checked.has(blockId);
}

export function clear(): void {
  if (checked.size === 0) return;
  checked.clear();
  notify();
}

/** Returns checked blocks sorted by order they were checked (oldest first). */
export function getChecked(): CheckedBlock[] {
  return Array.from(checked.values()).sort((a, b) => a.orderChecked - b.orderChecked);
}

/**
 * The composer anchors beneath the bottom-most checked block in the response
 * (DOM document order), not the most recently checked. Reading flows top→bottom,
 * so users expect the composer to sit beneath the last referenced material
 * regardless of which checkbox they clicked first.
 */
export function getAnchorBlockId(): string | null {
  if (checked.size === 0) return null;
  let anchor: string | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-ilui-block-id]')) {
    const id = el.getAttribute('data-ilui-block-id');
    if (id && checked.has(id)) anchor = id;
  }
  return anchor;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
