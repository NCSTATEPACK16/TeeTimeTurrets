/**
 * Which control a D-pad or stick press moves menu focus to (Stage 4b, spec §2.3): a pure function
 * of where the focusable controls are on screen, which one has focus, and the direction. DOM-free,
 * so it is tested in node; `PadMenuNavigator` measures the elements and moves the focus.
 *
 * Spatial, not list order: the screens lay buttons out in rows, columns and grids (the clubhouse's
 * swatch columns, the title's ride cards), and "right" should mean the one to the right.
 */

export type FocusDirection = "up" | "down" | "left" | "right";

/** A control's box on screen, in CSS pixels. */
export interface FocusRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const DIRECTIONS: Readonly<Record<FocusDirection, { x: number; y: number }>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** How much more a step sideways costs than a step forward: keeps a move in its own row or column. */
const OFF_AXIS_WEIGHT = 3;

/**
 * The index focus moves to, from `current` in `direction`. With nothing focused (`current` is -1
 * or out of range) the first control takes it. With nothing in that direction, focus stays.
 *
 * A candidate must lie ahead: its centre past the current one's along the direction. Among those,
 * the nearest wins, sideways distance counting `OFF_AXIS_WEIGHT` times as much as forward, and a
 * tie goes to the lower index.
 */
export function nextFocus(rects: readonly FocusRect[], current: number, direction: FocusDirection): number {
  if (rects.length === 0) return -1;
  if (current < 0 || current >= rects.length) return 0;
  const from = rects[current]!;
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const d = DIRECTIONS[direction];
  let best = current;
  let bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === current) continue;
    const r = rects[i]!;
    const dx = r.x + r.width / 2 - fx;
    const dy = r.y + r.height / 2 - fy;
    const forward = dx * d.x + dy * d.y;
    if (forward <= 0.5) continue;
    const sideways = Math.abs(dx * d.y - dy * d.x);
    const score = forward + OFF_AXIS_WEIGHT * sideways;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}
