/**
 * Where the map is looking, and how a world position becomes a pixel on it.
 *
 * DOM-free so the framing rules are asserted in the node suite rather than eyeballed against a
 * canvas -- the same split `hudState.ts` makes from `hud.ts`, and `plateState.ts` from
 * `nameplates.ts`.
 *
 * A hole sits in the course frame at an offset and a rotation. Today the course holds one hole at
 * the origin with no rotation, because `Sim` loads one hole at a time; the frame exists now so the
 * map does not have to be rebuilt when `src/sim/courseLayout.ts` places all eighteen.
 */

/** A hole's square field, placed in the course frame. */
export interface PlacedField {
  /** Metres along a side. The field is square and centred on the hole's own origin. */
  readonly fieldSize: number;
  /** The field centre's position in the course frame. */
  readonly offsetX: number;
  readonly offsetZ: number;
  /** Rotation of the hole's local frame within the course frame, radians. */
  readonly rotation: number;
}

/** An axis-aligned box in course-frame metres. */
export interface Bounds {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

/** World metres -> canvas pixels, preserving aspect so the course is never stretched. */
export interface MapProjection {
  readonly scale: number;
  x(courseX: number): number;
  y(courseZ: number): number;
}

/** A point in a hole's local frame, expressed in the course frame. */
export function toCourseFrame(
  field: PlacedField,
  localX: number,
  localZ: number,
  out: { x: number; z: number },
): void {
  const cos = Math.cos(field.rotation);
  const sin = Math.sin(field.rotation);
  // Rotate about the field's own centre, then translate: the offset is where the centre lands,
  // so rotating after translating would swing the hole around the course origin instead.
  out.x = field.offsetX + localX * cos - localZ * sin;
  out.z = field.offsetZ + localX * sin + localZ * cos;
}

/**
 * The axis-aligned box a set of placed fields occupies, including the sweep of any rotation.
 *
 * A square of side s turned by t needs s * (|cos t| + |sin t|) to contain it -- at 45 degrees that
 * is s * sqrt(2). Using the unrotated side would clip the corners of every angled hole.
 */
export function boundsOf(fields: readonly PlacedField[]): Bounds {
  // Seeded at zero rather than +/-Infinity: an empty course is a degenerate map, not a broken
  // one, and an infinite bound propagates NaN through the projection.
  if (fields.length === 0) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };

  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const field of fields) {
    const sweep = (field.fieldSize / 2) * (Math.abs(Math.cos(field.rotation)) + Math.abs(Math.sin(field.rotation)));
    if (field.offsetX - sweep < minX) minX = field.offsetX - sweep;
    if (field.offsetZ - sweep < minZ) minZ = field.offsetZ - sweep;
    if (field.offsetX + sweep > maxX) maxX = field.offsetX + sweep;
    if (field.offsetZ + sweep > maxZ) maxZ = field.offsetZ + sweep;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Grows a box by `metres` on every side, so markers at the very edge are not clipped. */
export function padBounds(bounds: Bounds, metres: number): Bounds {
  return {
    minX: bounds.minX - metres,
    minZ: bounds.minZ - metres,
    maxX: bounds.maxX + metres,
    maxZ: bounds.maxZ + metres,
  };
}

/**
 * Fits `bounds` inside a `width` x `height` canvas, centred, at one scale for both axes.
 *
 * One scale rather than two is the whole point: a course stretched to fill a wide viewport would
 * misreport every angle on it, and the angle between a tee and a green is the thing a player is
 * reading the map for.
 */
export function fitProjection(
  bounds: Bounds,
  width: number,
  height: number,
  paddingPx: number,
): MapProjection {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const usableW = Math.max(0, width - paddingPx * 2);
  const usableH = Math.max(0, height - paddingPx * 2);

  // A zero-extent box would divide by zero. Scale 1 keeps the projection finite and puts the
  // single point in the middle of the canvas, which is the only sensible picture of it.
  const scale = spanX > 0 && spanZ > 0 ? Math.min(usableW / spanX, usableH / spanZ) : 1;

  // Whatever the fitted axis does not use is split evenly, so the course sits centred rather
  // than pinned to a corner.
  const originX = paddingPx + (usableW - spanX * scale) / 2;
  const originZ = paddingPx + (usableH - spanZ * scale) / 2;

  return {
    scale,
    x: (courseX: number) => originX + (courseX - bounds.minX) * scale,
    // World +Z runs *down* the page, the same handedness the heightfield uses (row -> Z) and the
    // committed plans draw. Flipping it here would mirror every dog-leg.
    y: (courseZ: number) => originZ + (courseZ - bounds.minZ) * scale,
  };
}
