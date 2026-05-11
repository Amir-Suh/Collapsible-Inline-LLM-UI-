import { CanaryBanner } from './CanaryBanner';
import type { CanaryResult } from '../gemini-dom';

export function Root({ canary }: { canary: CanaryResult }) {
  if (!canary.ok) return <CanaryBanner result={canary} />;
  return null;
}
