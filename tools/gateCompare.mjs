/**
 * Pure comparison half of the Scene Gate. No I/O, no Puppeteer, no filesystem -- so the
 * thresholds, which are the only part of the gate with logic that can be silently wrong, are
 * testable in the node environment alongside everything else.
 *
 * Design note (spec section 3c): the perceptual half compares a downsampled RGB grid rather than a
 * full-resolution PNG. Downsampling is what buys tolerance to antialiasing and rasteriser
 * noise, it costs no new dependencies, and a JSON grid diffs legibly in git where a PNG does
 * not. Its blind spot -- a small high-frequency change such as one club-head facet -- is
 * covered by the exact triangle and vertex comparison below, which is why both halves exist.
 */

/** 16:9, matching the harness viewport. Small enough to average away edge noise. */
export const SIGNATURE_WIDTH = 64;
export const SIGNATURE_HEIGHT = 36;

/**
 * Counts are compared exactly: procedural geometry is deterministic, so a changed count is a
 * changed model and there is no noise to tolerate. Only the bounding box gets a band, and it is
 * narrow enough that a real silhouette change cannot hide inside it.
 */
export function compareMetrics(baseline, actual, bboxTolerance = 0.005) {
  const failures = [];

  if (actual.vertices !== baseline.vertices) {
    failures.push(`vertices ${actual.vertices} != baseline ${baseline.vertices}`);
  }
  if (actual.triangles !== baseline.triangles) {
    failures.push(`triangles ${actual.triangles} != baseline ${baseline.triangles}`);
  }

  for (const axis of ["x", "y", "z"]) {
    const want = baseline.bbox[axis];
    const got = actual.bbox[axis];
    // Guard the zero case so a flat subject does not divide by zero into a false pass.
    const drift = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
    if (drift > bboxTolerance) {
      failures.push(
        `bbox.${axis} ${got.toFixed(4)} != baseline ${want.toFixed(4)} ` +
          `(${(drift * 100).toFixed(2)}% > ${(bboxTolerance * 100).toFixed(2)}%)`,
      );
    }
  }

  return failures;
}

/**
 * Mean absolute per-channel delta across the whole grid, plus the worst single channel. The mean
 * is what the threshold gates on; maxDelta is reported so a failure says whether the whole image
 * shifted or one region did.
 */
export function compareSignature(baseline, actual, threshold = 6) {
  if (baseline.length !== actual.length) {
    throw new Error(`signature length mismatch: baseline ${baseline.length}, actual ${actual.length}`);
  }

  let total = 0;
  let maxDelta = 0;
  for (let i = 0; i < baseline.length; i++) {
    const delta = Math.abs(baseline[i] - actual[i]);
    total += delta;
    if (delta > maxDelta) maxDelta = delta;
  }

  const meanDelta = baseline.length === 0 ? 0 : total / baseline.length;
  return { ok: meanDelta <= threshold, meanDelta, maxDelta };
}
