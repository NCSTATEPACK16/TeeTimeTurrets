/**
 * `?match=N` shortens the match clock to N seconds, so a play-test item takes a minute rather than
 * three. Clamped to 15–180 s. Missing or unreadable gives `undefined`, which leaves the Sim's own
 * default (`MATCH_DURATION_S`) in charge.
 */
export const MATCH_QUERY_MIN_S = 15;
export const MATCH_QUERY_MAX_S = 180;

export function matchSecondsFromQuery(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("match");
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(MATCH_QUERY_MAX_S, Math.max(MATCH_QUERY_MIN_S, n));
}
