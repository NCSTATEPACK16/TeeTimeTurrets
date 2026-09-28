import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Everything a match needs that the title screen does not: the sim and Rapier, the course world,
 * and the match and results screens. `main.ts` reaches it through one dynamic import, so the
 * first chunk the browser loads holds the title, the clubhouse and three, and Rapier's WASM --
 * most of the download -- arrives while the player is still reading the menu.
 *
 * The title prefetches it (`main.ts`), and `warmPhysics` starts Rapier's WASM compiling then too,
 * so PLAY rarely waits on either.
 */
export { Sim } from "../sim/world";
export { buildCourseWorld } from "../sim/courseWorld";
export { arenaFromCourse } from "../sim/arena";
export { MatchScreen } from "../ui/screens/MatchScreen";
export { MatchResultsScreen } from "../ui/screens/MatchResultsScreen";
export { courseMapHoles } from "../ui/courseMapHoles";

/** Starts Rapier's WASM compiling. `Sim.create` awaits the same promise, so calling this early only
 *  moves the cost; calling it twice costs nothing. */
export function warmPhysics(): Promise<void> {
  return RAPIER.init();
}
