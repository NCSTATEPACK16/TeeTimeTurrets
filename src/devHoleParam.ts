/**
 * Dev-only hole picker for the URL viewer: `?hole=N` selects which generated hole loads at
 * startup, ahead of the real course-select flow Phase 1.75 owns. Pure so it tests without a DOM.
 */
export function parseHoleIndex(search: string, holeCount: number): number {
  const raw = new URLSearchParams(search).get("hole");
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), holeCount - 1);
}
