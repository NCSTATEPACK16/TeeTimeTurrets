import * as THREE from "three";
import { ScreenManager } from "./app/ScreenManager";
import { GameLoop } from "./engine/GameLoop";
import { FIXED_DT, Sim } from "./sim/world";
import { generateCourse } from "./sim/course";
import { Round } from "./sim/round";
import { parseHoleIndex } from "./devHoleParam";
import { createLoadout, tireTypeFor } from "./sim/loadout";
import { earningsFor } from "./sim/wallet";
import { ClubhouseScreen } from "./ui/screens/ClubhouseScreen";
import { RoundScreen } from "./ui/screens/RoundScreen";
import { ResultsScreen } from "./ui/screens/ResultsScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";

/**
 * Boot and routing. Everything that used to live here -- the sim, the scene, the input, the HUD
 * wiring, the frame view -- is now `RoundScreen`; this file's job is to own the things that
 * outlive any one screen (the renderer, the loop, the course, the round) and to say which screen
 * comes next.
 *
 * That split is Phase 1.75's whole point. One WebGL context is shared by the title backdrop, the
 * round and later the clubhouse; each screen builds and frees its own scene around it.
 */

/*
 * KNOWN DEFECT, fixed in the change that follows this one: NEXT HOLE does not advance a round.
 * `startRound` below replaces `round` with a fresh `Round` on every hole, which wipes the card
 * and resets `holeIndex` to 0 -- so the second hole is replayed forever and the round can never
 * complete. It is left here rather than fixed in passing because the fix is a design decision
 * about where the four scorecard counters live (see the constructor comment in `sim/round.ts`),
 * and it wants its own change with a test that fails first.
 */

/**
 * Fixed until a course-select screen exists. Changing it changes every hole, which is the whole
 * point of the seed -- and is the cheapest way to eyeball generation variety during development.
 */
const COURSE_SEED = 2026;
const VERSION = "v0.0.1";

type ScreenName = "title" | "round" | "results" | "clubhouse";

async function main(): Promise<void> {
  const container = document.getElementById("app");
  const screensRoot = document.getElementById("screens");
  const hudRoot = document.getElementById("hud");
  const nameplateRoot = document.getElementById("nameplates");
  if (!container || !screensRoot || !hudRoot || !nameplateRoot) {
    throw new Error("expected #app, #screens, #hud and #nameplates in index.html");
  }

  // Created once and shared. A context per screen would hit the browser's hard limit on live
  // WebGL contexts within a few transitions, and lose the title backdrop's whole reason to exist.
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const course = generateCourse(COURSE_SEED, 18);
  const holeIndex = parseHoleIndex(window.location.search, course.holes.length);

  const screens = new ScreenManager<ScreenName>();

  // One live round for the session. `Round` wraps `sim.stats` by reference once the sim exists,
  // so the scorecard's four tiles read the same counters combat.ts writes.
  let round = new Round(course.holes.map((h) => h.par));
  let sim: Sim | null = null;
  let roundScreen: RoundScreen | null = null;

  // Session-scoped for now. Persisting these is BACKLOG #48's job; the clubhouse works either way
  // because it only ever reads and writes them through here.
  let loadout = createLoadout();
  let coins = 6000;

  const startRound = async (): Promise<void> => {
    const spec = course.holes[Math.min(round.holeIndex, course.holes.length - 1)];
    if (!spec) throw new Error("course has no holes");
    // The one purchase that is not cosmetic: the tire the player bought is the tire the physics
    // uses, which is what makes ROADMAP.md's "tire type is a stat, not a skin" true rather than
    // merely stated.
    sim = await Sim.create(spec, { tire: tireTypeFor(loadout) });
    round = new Round(
      course.holes.map((h) => h.par),
      sim.stats,
    );
    screens.show("round");
  };

  screens.register("title", () => {
    const backdropHole = course.holes[holeIndex] ?? course.holes[0]!;
    return new TitleScreen({
      root: screensRoot,
      renderer,
      backdropHole,
      version: VERSION,
      actions: {
        play: () => void startRound(),
        clubhouse: () => screens.show("clubhouse"),
        // Still undefined, so these render visibly disabled rather than absent -- ROADMAP.md
        // asks for exactly that: a button that looks alive and does nothing is worse.
        multiplayer: undefined,
        settings: undefined,
      },
    });
  });

  screens.register("round", () => {
    const live = sim;
    if (!live) throw new Error("round screen entered with no sim");
    roundScreen = new RoundScreen({
      renderer,
      sim: live,
      round,
      hudRoot,
      nameplateRoot,
      onHoleComplete: (strokes) => {
        round.completeHole(strokes);
        coins += earningsFor(round);
        // Mouse-aim players are pointer-locked and cannot reach a button until it is released.
        if (document.pointerLockElement !== null) document.exitPointerLock();
        screens.show("results");
      },
    });
    return roundScreen;
  });

  screens.register("clubhouse", () => {
    return new ClubhouseScreen({
      root: screensRoot,
      renderer,
      loadout,
      coins,
      onConfirm: (next, remaining) => {
        loadout = next;
        coins = remaining;
      },
      onBack: () => screens.show("title"),
    });
  });

  screens.register("results", () => {
    const behind = roundScreen;
    return new ResultsScreen({
      root: screensRoot,
      round,
      // Keeps the finished hole on screen under the scrim instead of a black page.
      drawBehind: behind ? () => behind.drawStill() : undefined,
      actions: {
        mainMenu: () => screens.show("title"),
        nextHole: round.complete ? undefined : () => void startRound(),
      },
    });
  });

  // Dev-only inspection hook for manual tuning in the browser console, and what tools/smoke.mjs
  // drives. Getters rather than fixed values: `sim` and the scene are rebuilt on every round, so
  // a snapshot taken at boot would go stale the moment the player pressed PLAY.
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = {
    get sim() {
      return sim;
    },
    get render() {
      return roundScreen?.scene ?? null;
    },
    get round() {
      return round;
    },
    get screen() {
      return screens.activeName;
    },
    course,
    screens,
    // Exposed for the Phase 1.75 memory gate in tools/smoke.mjs: `renderer.info.memory` is the
    // only honest way to ask whether a screen gave its geometries and textures back.
    renderer,
  };

  const loop = new GameLoop({
    fixedDt: FIXED_DT,
    step: () => screens.step(),
    render: (alpha) => screens.draw(alpha),
  });

  screens.show("title");
  loop.start();
}

main().catch((err: unknown) => {
  console.error(err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem;font:14px monospace;white-space:pre-wrap">${message}</pre>`;
});
