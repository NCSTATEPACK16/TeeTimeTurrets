import * as THREE from "three";
import { ScreenManager } from "./app/ScreenManager";
import { GameLoop } from "./engine/GameLoop";
import { FrameStats, createFrameReport } from "./engine/frameStats";
import { FIXED_DT } from "./sim/tickConstants";
import { authoredCourse } from "./sim/authoredCourse";
import type { CourseWorld } from "./sim/courseWorld";
import type { Sim } from "./sim/world";
import { ARENA_BOTS } from "./sim/matchConfig";
import { createLoadout, tireTypeFor } from "./sim/loadout";
import type { ArenaSource } from "./render/scene";
import { ClubhouseScreen } from "./ui/screens/ClubhouseScreen";
import type { MatchScreen } from "./ui/screens/MatchScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";
import { gameAudio } from "./audio/audioEngine";
import { loadSettings, pageStorage, saveSettings } from "./app/settings";
import type { Settings } from "./app/settings";
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import { mountPerfOverlay } from "./ui/perfOverlay";

type MatchPath = typeof import("./app/matchPath");

/**
 * Boot and routing. This file owns the things that outlive any one screen -- the renderer, the
 * loop, the course and the player's loadout -- and says which screen comes next. One WebGL context
 * is shared by the title backdrop, the match and the clubhouse; each screen builds and frees its
 * own scene around it.
 */

/** The course is authored; the seed drives only its seeded detail (bunkers, rough, trees). */
const COURSE_SEED = 2026;
const VERSION = "v0.1.0";

/** Coins a new player starts with, until progression pays out per match. */
const STARTING_COINS = 6000;

type ScreenName = "title" | "match" | "matchResults" | "clubhouse" | "settings";

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
  let settings: Settings = loadSettings(pageStorage());
  const applySettings = (next: Settings): void => {
    settings = next;
    gameAudio.setLevels(settings);
    saveSettings(pageStorage(), settings);
  };
  // Browsers only start audio from a user gesture. Every gesture calls it, because a context can
  // also be suspended later (a hidden tab), and `unlock` resumes it.
  const unlockAudio = (): void => {
    gameAudio.unlock();
    gameAudio.setLevels(settings);
  };
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  window.addEventListener("keydown", unlockAudio, { capture: true });

  const course = authoredCourse(COURSE_SEED);
  const screens = new ScreenManager<ScreenName>();

  /**
   * The match path -- sim, Rapier, course world, match screens -- is its own chunk (`matchPath.ts`).
   * Fetched once, the first time anything asks: the title asks as soon as it shows, so by the time
   * the player presses PLAY it has usually arrived.
   */
  let matchPath: MatchPath | null = null;
  let matchPathLoading: Promise<MatchPath> | null = null;
  const loadMatchPath = (): Promise<MatchPath> => {
    matchPathLoading ??= import("./app/matchPath").then((loaded) => {
      matchPath = loaded;
      return loaded;
    });
    return matchPathLoading;
  };
  const prefetchMatchPath = (): void => {
    loadMatchPath()
      .then((loaded) => loaded.warmPhysics())
      // A prefetch that fails is not an error yet: PLAY asks again and reports it then.
      .catch(() => {
        matchPathLoading = null;
      });
  };


  let sim: Sim | null = null;
  let matchScreen: MatchScreen | null = null;
  /**
   * Built on the first PLAY and kept for the page. Eighteen heightfields and the blended course
   * cost about a second, and the seed is fixed, so rebuilding per match could only arrive at
   * exactly the same course.
   */
  let courseWorld: CourseWorld | null = null;
  let arenaSource: ArenaSource | null = null;

  // Page-scoped for now; persisting the player's profile is the progression work's job.
  let loadout = createLoadout();
  let coins = STARTING_COINS;

  const startMatch = async (): Promise<void> => {
    const path = await loadMatchPath();
    if (courseWorld === null) {
      courseWorld = path.buildCourseWorld(course, COURSE_SEED);
      arenaSource = {
        course: courseWorld.terrain,
        surfaces: courseWorld.surfaces,
        southBoundary: courseWorld.southBoundary,
        seed: COURSE_SEED,
        clubhouse: path.AUTHORED_CLUBHOUSE,
        pickupSites: path.placePickupSites(path.courseSiteGround(courseWorld), path.AUTHORED_CLUBHOUSE, COURSE_SEED),
      };
      // The M map's holes, sampled now, while PLAY is already loading, rather than on first open
      // in the middle of a fight. Cached for the page, like the course.
      path.courseMapHoles(arenaSource);
    }
    // A Rapier world lives on the WASM heap, which the garbage collector cannot see: the previous
    // match's has to be freed by hand or every rematch leaks a whole course.
    sim?.dispose();
    // The tire the player bought is the tire the physics uses: the one purchase that is a stat.
    sim = await path.Sim.create(path.arenaFromCourse(courseWorld, arenaSource?.pickupSites), {
      tire: tireTypeFor(loadout),
      botCount: ARENA_BOTS,
    });
    screens.show("match");
  };

  screens.register("title", () => {
    prefetchMatchPath();
    return new TitleScreen({
      root: screensRoot,
      renderer,
      backdropHole: course.holes[0]!,
      version: VERSION,
      actions: {
        play: () => void startMatch(),
        clubhouse: () => screens.show("clubhouse"),
        // Still undefined, so it renders visibly disabled rather than absent.
        multiplayer: undefined,
        settings: () => screens.show("settings"),
      },
    });
  });

  screens.register("match", () => {
    const live = sim;
    const arena = arenaSource;
    if (!live || !arena || !matchPath) throw new Error("match screen entered with no sim or no course");
    matchScreen = new matchPath.MatchScreen({
      renderer,
      sim: live,
      arena,
      hudRoot,
      nameplateRoot,
      onMatchOver: () => screens.show("matchResults"),
      overlayRoot: screensRoot,
      settings,
      onSettingsChange: applySettings,
      onQuit: () => screens.show("title"),
    });
    return matchScreen;
  });

  screens.register("matchResults", () => {
    const live = sim;
    const behind = matchScreen;
    if (!live || !matchPath) throw new Error("results screen entered with no sim");
    return new matchPath.MatchResultsScreen({
      root: screensRoot,
      match: live.match,
      // Keeps the finished match on screen under the scrim.
      drawBehind: behind ? () => behind.drawStill() : undefined,
      actions: {
        // The same Sim and the same cached course: `Sim.reset()` re-tees every cart, resets the
        // seeded streams and the clock, so a rematch replays rather than rebuilding eighteen holes.
        playAgain: () => {
          live.reset();
          screens.show("match");
        },
        mainMenu: () => screens.show("title"),
      },
    });
  });

  screens.register("settings", () => {
    return new SettingsScreen({
      root: screensRoot,
      settings,
      onChange: applySettings,
      onBack: () => screens.show("title"),
    });
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

  // Frame time and draw calls, for the dev hook's `perf` and the `?perf` overlay. The renderer's
  // counters are reset once per frame rather than per `render` call, so a frame drawn in several
  // passes (the High preset's post chain) reports all of them.
  const frameStats = new FrameStats();
  const frameReport = createFrameReport();
  renderer.info.autoReset = false;
  if (new URLSearchParams(window.location.search).has("perf")) {
    mountPerfOverlay(document.body, () => frameStats.report(frameReport), () => renderer.getPixelRatio());
  }

  // Dev-only inspection hook for manual tuning in the browser console, and what tools/smoke.mjs
  // drives. Getters rather than fixed values: `sim` and the scene are rebuilt on every match.
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = {
    /** The last `FRAME_STATS_WINDOW` frames: frame and work times, draw calls, triangles. */
    get perf() {
      return { ...frameStats.report(createFrameReport()), pixelRatio: renderer.getPixelRatio() };
    },
    get sim() {
      return sim;
    },
    get render() {
      return matchScreen?.scene ?? null;
    },
    get coins() {
      return coins;
    },
    get screen() {
      return screens.activeName;
    },
    course,
    screens,
    // Exposed for the memory gate in tools/smoke.mjs: `renderer.info.memory` is the only honest way
    // to ask whether a screen gave its geometries and textures back.
    renderer,
  };

  // Work is timed from the frame's first step to the end of its draw: everything the loop does.
  let frameStartMs = -1;
  const loop = new GameLoop({
    fixedDt: FIXED_DT,
    step: () => {
      if (frameStartMs < 0) frameStartMs = performance.now();
      screens.step();
    },
    render: (alpha) => {
      // The interval is taken at the draw, once a frame, so it follows the display; the work
      // starts at the frame's first step when it had one.
      const drawAt = performance.now();
      const workFrom = frameStartMs < 0 ? drawAt : frameStartMs;
      renderer.info.reset();
      screens.draw(alpha);
      frameStats.record(drawAt, performance.now() - workFrom, renderer.info.render.calls, renderer.info.render.triangles);
      frameStartMs = -1;
    },
  });

  screens.show("title");
  loop.start();
}

main().catch((err: unknown) => {
  console.error(err);
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.body.innerHTML = `<pre style="color:#f66;padding:2rem;font:14px monospace;white-space:pre-wrap">${message}</pre>`;
});
