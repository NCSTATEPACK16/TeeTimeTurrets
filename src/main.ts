import * as THREE from "three";
import { ScreenManager } from "./app/ScreenManager";
import { GameLoop } from "./engine/GameLoop";
import { FrameStats } from "./engine/frameStats";
import { FIXED_DT } from "./sim/frame";
import type { Sim } from "./sim/world";
import { authoredCourse } from "./sim/authoredCourse";
import { buildCourseWorld } from "./sim/courseWorld";
import type { CourseWorld } from "./sim/courseWorld";
import { arenaFromCourse } from "./sim/arena";
import { ARENA_BOTS } from "./sim/matchConfig";
import { createLoadout, tireTypeFor } from "./sim/loadout";
import type { ArenaSource } from "./render/scene";
import { ClubhouseScreen } from "./ui/screens/ClubhouseScreen";
import { MatchScreen } from "./ui/screens/MatchScreen";
import { MatchResultsScreen } from "./ui/screens/MatchResultsScreen";
import { TitleScreen } from "./ui/screens/TitleScreen";
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import { browserStore, hasSeenControls, loadSettings, markControlsSeen, saveSettings } from "./app/settings";
import type { Settings } from "./app/settings";
import { AudioEngine } from "./audio/synth";
import { pixelRatioFor, probeDeviceFacts, resolveQuality } from "./render/quality";
import { applyColourPipeline } from "./render/colour";
import type { QualityPreset } from "./render/quality";

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

  const store = browserStore();
  let settings: Settings = loadSettings(store);

  // The quality preset is resolved before the renderer exists, because it decides whether the
  // context is multisampled -- which cannot change without a new context.
  const device = probeDeviceFacts();
  let quality: QualityPreset = resolveQuality(settings.quality, device);

  // Created once and shared. A context per screen would hit the browser's hard limit on live
  // WebGL contexts within a few transitions, and lose the title backdrop's whole reason to exist.
  const renderer = new THREE.WebGLRenderer({ antialias: quality.msaa });
  applyColourPipeline(renderer);
  const fitRenderer = (): void => {
    renderer.setPixelRatio(pixelRatioFor(quality, window.devicePixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  fitRenderer();
  container.appendChild(renderer.domElement);
  window.addEventListener("resize", fitRenderer);

  const audio = new AudioEngine(settings);
  // Browsers only start audio from inside a gesture. Every click and key is one; unlocking an
  // unlocked engine does nothing, so the listeners simply stay.
  window.addEventListener("pointerdown", () => audio.unlock());
  window.addEventListener("keydown", () => audio.unlock());
  const changeSettings = (next: Settings): void => {
    settings = next;
    saveSettings(store, settings);
    audio.apply(settings);
    quality = resolveQuality(settings.quality, device);
    fitRenderer();
  };

  const course = authoredCourse(COURSE_SEED);
  const screens = new ScreenManager<ScreenName>();

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

  /**
   * The sim and Rapier, loaded on the first PLAY rather than with the page: Rapier inlines its WASM
   * and is most of the bundle, and nothing before a match needs it. Prefetched once the title has
   * drawn, so PLAY rarely waits on it. Forgotten on failure, so the next PLAY tries again.
   */
  let simModule: Promise<typeof import("./sim/world")> | null = null;
  const loadSim = (): Promise<typeof import("./sim/world")> => {
    simModule ??= import("./sim/world").catch((err: unknown) => {
      simModule = null;
      throw err;
    });
    return simModule;
  };

  const startMatch = async (): Promise<void> => {
    const { Sim } = await loadSim();
    if (courseWorld === null) {
      courseWorld = buildCourseWorld(course, COURSE_SEED);
      const playfield = arenaFromCourse(courseWorld).playfield;
      arenaSource = {
        course: courseWorld.terrain,
        surfaces: courseWorld.surfaces,
        southBoundary: courseWorld.southBoundary,
        seed: COURSE_SEED,
        heightAt: (x, z) => playfield.heightAt(x, z),
      };
    }
    // A Rapier world lives on the WASM heap, which the garbage collector cannot see: the previous
    // match's has to be freed by hand or every rematch leaks a whole course.
    sim?.dispose();
    // The tire the player bought is the tire the physics uses: the one purchase that is a stat.
    sim = await Sim.create(arenaFromCourse(courseWorld), {
      tire: tireTypeFor(loadout),
      botCount: ARENA_BOTS,
    });
    screens.show("match");
  };

  screens.register("title", () => {
    // After the title's first frame, so the download never competes with it.
    requestAnimationFrame(() => setTimeout(() => void loadSim().catch(() => {}), 0));
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
    if (!live || !arena) throw new Error("match screen entered with no sim or no course");
    matchScreen = new MatchScreen({
      renderer,
      sim: live,
      arena,
      hudRoot,
      nameplateRoot,
      onMatchOver: () => screens.show("matchResults"),
      screensRoot,
      audio,
      settings: () => settings,
      onSettingsChange: changeSettings,
      onMainMenu: () => screens.show("title"),
      showControls: !hasSeenControls(store),
      onControlsSeen: () => markControlsSeen(store),
      quality,
    });
    return matchScreen;
  });

  screens.register("settings", () => {
    return new SettingsScreen({
      root: screensRoot,
      settings: () => settings,
      onChange: changeSettings,
      onBack: () => screens.show("title"),
    });
  });

  screens.register("matchResults", () => {
    const live = sim;
    const behind = matchScreen;
    if (!live) throw new Error("results screen entered with no sim");
    return new MatchResultsScreen({
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

  // Dev-only inspection hook for manual tuning in the browser console, and what tools/smoke.mjs
  // drives. Getters rather than fixed values: `sim` and the scene are rebuilt on every match.
  (window as unknown as { __teetimeturrets: unknown }).__teetimeturrets = {
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
    audio,
    get settings() {
      return settings;
    },
    get quality() {
      return quality;
    },
    /** Changes settings as the Settings screen does: saved, and applied where it applies. */
    setSettings: (patch: Partial<Settings>) => changeSettings({ ...settings, ...patch }),
    device,
    get match() {
      return matchScreen;
    },
    // Exposed for the memory gate in tools/smoke.mjs: `renderer.info.memory` is the only honest way
    // to ask whether a screen gave its geometries and textures back.
    renderer,
    /** The last four seconds of frames: `__teetimeturrets.perf` in the console. */
    get perf() {
      return frameStats.summary();
    },
    resetPerf: () => frameStats.reset(),
  };

  // Frame time, CPU work and draw calls, for the dev hook below. Draw calls are counted over the
  // whole frame rather than per `render()` call, so a composer's passes add up instead of the last
  // one overwriting the rest.
  const frameStats = new FrameStats();
  renderer.info.autoReset = false;
  let workStart = 0;
  const loop = new GameLoop({
    fixedDt: FIXED_DT,
    step: () => {
      if (workStart === 0) workStart = performance.now();
      screens.step();
    },
    render: (alpha) => {
      const start = workStart === 0 ? performance.now() : workStart;
      renderer.info.reset();
      screens.draw(alpha);
      const end = performance.now();
      frameStats.record(end, end - start, renderer.info.render.calls, renderer.info.render.triangles);
      workStart = 0;
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
