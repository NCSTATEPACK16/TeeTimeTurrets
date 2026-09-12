/**
 * Every arena tunable, in one module.
 *
 * **These are playtest placeholders, not derived constants.** Match length, team sizes, respawn
 * and spawn rates are the kind of number that is settled by playing the mode, and the decision
 * was made deliberately to ship real values here and move them after a session rather than to
 * reason them into existence first. The one exception is `ARENA_MAX_HEALTH`, which is derived
 * below and says what from.
 *
 * A leaf by construction: this module imports nothing from `src/sim/**`. `world.ts`, `course.ts`
 * and `surfaces.ts` all import *it*, and a value-import cycle through here is the shipping hazard
 * `docs/TEST-AND-SPEC-PITFALLS.md` §6 is about -- `tools/importCycles.test.mjs` fails the suite
 * on one. Keep it a leaf.
 *
 * DOM-free and Rapier-free, like everything else in `src/sim/**`.
 */

/**
 * Match length in seconds. Three minutes is long enough for the engagement range to matter and
 * short enough that a match is a sitting rather than a session. Overridable per `Sim.create` so
 * a test can run a match to its end in a handful of ticks instead of 180 real seconds.
 *
 * Lived in `world.ts` until Stage C; re-exported from there so existing callers are unchanged.
 */
export const MATCH_DURATION_S = 180;

/**
 * Every player-indexed structure in `match.ts` is sized for this and allocated once.
 *
 * It is a Phase 5 target and this build ships single-player against bots, so the arrays will
 * not be filled. The data model is the part that would be a rewrite later, which is the whole
 * reason to size it now rather than to grow it when the roster does.
 */
export const MAX_PLAYERS = 24;

export const TEAM_COUNT = 2;

/**
 * Bots in an arena match, over and above the human.
 *
 * Five rather than the one a hole spawns, because arena's scoring needs sides to be meaningful:
 * `teamOf` alternates, so six carts is three against three and the team-strokes total is a real
 * aggregate rather than one player's deaths under another name. Well inside `MAX_PLAYERS`.
 *
 * The ceiling is draw calls, not the sim: `docs/HANDOFF.md` measures 78 per cart, so six carts is
 * ~470 before any ground. That is the number to revisit first if arena runs slow.
 */
export const ARENA_BOTS = 5;

/**
 * Which side a player is on.
 *
 * Alternating rather than splitting the roster in half so that **any** count gives sides that
 * differ by at most one -- including the one-player, one-bot match this build actually runs,
 * which a `index < count / 2` split would put 1-1 only by accident of the count being even.
 * At 24 the two rules agree; at 3 they do not, and 3 is a roster this game can have.
 *
 * The human is rig 0 and is therefore always on team 0.
 */
export function teamOf(index: number): number {
  return index % TEAM_COUNT;
}

/**
 * The health bar in arena, flat.
 *
 * Stroke play sizes a cart at `2 x par`, because a hole's par is the strokes it is worth.
 * **Arena has no par**, so it cannot inherit that rule and this is the number chosen instead.
 * One ball hit is one point (`combat.ts`'s `STROKE_DAMAGE`), so eight hits kill -- inside the
 * 6-10 band `2 x par` produces across the par mix, which is what makes the combat feel tuned
 * for stroke play carry over unchanged.
 *
 * Set once by `Sim.loadCourse` and never re-sized. That is the substance of the fix for the
 * open question `docs/HANDOFF.md` carried for several sessions: the defect was never the number,
 * it was `setMaxHealth` refilling the bar as a side effect of a mode-level event.
 */
export const ARENA_MAX_HEALTH = 8;

/**
 * Seconds a freshly respawned cart cannot be shot. Granted by `Sim.stepRespawn` and by nothing
 * else -- it is a property of respawning, not of being alive, so `Sim.reset` handing out a fresh
 * hole does not hand out shields with it.
 *
 * **Firing gives it up** (`Cart.fire`). Without that the strongest opening move is to sit on a
 * tee and shoot from behind it.
 */
export const SPAWN_PROTECTION_S = 3;

/**
 * How far a candidate respawn tee must be from any living cart. Well past `BOT_ENGAGE_RANGE`
 * (40 m), so a respawn does not land inside a fight already in progress.
 */
export const SPAWN_CLEARANCE_M = 60;

/**
 * Draws from the seeded stream before giving up and taking the farthest tee instead. Eight is
 * enough to find one of eighteen tees while a handful are contested, and bounded so a match in
 * which every tee is crowded still respawns on the tick it is due rather than spinning.
 */
export const SPAWN_TRIES = 8;

/**
 * The killer of a death nobody caused: drowning, or any death with no other cart involved.
 *
 * Negative on purpose, and asserted to be. `Match.scoreKill` guards on it before indexing
 * `points`, and a sentinel of 0 would credit the human for every drowning on the course.
 */
export const NO_KILLER = -1;

/**
 * The `hashChannel` channel the respawn-tee stream is drawn on, alongside `bot.ts`'s
 * `BOT_CHANNEL` (3). A channel of its own so that changing how often carts die does not shift
 * every bot's decisions with it -- the same reason each bot already has one.
 */
export const SPAWN_CHANNEL = 4;
