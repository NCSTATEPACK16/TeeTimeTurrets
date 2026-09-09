/**
 * A name pill, distance and health bar over each cart -- BACKLOG #34b, images 07 and 09.
 *
 * The elements are built once and repositioned every frame, which is exactly how a nameplate
 * differs from a hit marker: UI-SPEC H11's markers are one-shot nodes that animate themselves
 * and are thrown away, and H13's plates persist. Positioned with `translate3d`, never
 * `left`/`top`, per UI-SPEC's projection rule.
 *
 * DOM only, and deliberately dumb: what a plate *says* and whether it may be seen at all are
 * decided in `src/ui/plateState.ts`, which is DOM-free and covered by the node suite. This module
 * writes the result to elements and nothing else. The world->screen projection happens in
 * `src/render/scene.ts`, which owns the camera; this module never sees three.
 */

import { createPlateStateScratch, derivePlateState } from "./plateState";
import type { PlateSource, PlateTeam } from "./plateState";

/** One scratch object for the whole module: `setPlate` runs once per cart per frame, and the
 *  render loop is covered by the no-allocation rule. */
const scratch = createPlateStateScratch();

export class Nameplates {
  private readonly root: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly fills: HTMLElement[] = [];
  private readonly distances: HTMLElement[] = [];

  constructor(container: HTMLElement, labels: readonly string[], teams: readonly PlateTeam[]) {
    this.root = container;
    for (let i = 0; i < labels.length; i++) {
      const plate = document.createElement("div");
      // The team is fixed for the life of the plate, so it is a class rather than a per-frame
      // write: the colour is the stylesheet's business, not this loop's.
      plate.className = `nameplate nameplate-${teams[i] ?? "enemy"}`;
      plate.hidden = true;

      const name = document.createElement("span");
      name.className = "nameplate-name";
      name.textContent = labels[i] ?? "";

      const distance = document.createElement("span");
      distance.className = "nameplate-distance";

      const track = document.createElement("div");
      track.className = "nameplate-track";
      const fill = document.createElement("div");
      fill.className = "nameplate-fill";
      track.appendChild(fill);

      plate.appendChild(name);
      plate.appendChild(distance);
      plate.appendChild(track);
      this.root.appendChild(plate);
      this.plates.push(plate);
      this.fills.push(fill);
      this.distances.push(distance);
    }
  }

  /**
   * Places one plate. Visibility, the distance string and opacity all come from
   * `derivePlateState`; a cart that is off screen, or an enemy whose last sighting has faded out,
   * is hidden rather than parked, so a plate never appears clamped to a screen edge.
   *
   * Every write is guarded against its current value: this runs per cart per frame at 60fps, and
   * an unguarded write dirties the DOM whether or not anything changed.
   */
  setPlate(index: number, screenX: number, screenY: number, source: PlateSource): void {
    const plate = this.plates[index];
    const fill = this.fills[index];
    const distance = this.distances[index];
    if (plate === undefined || fill === undefined || distance === undefined) return;

    derivePlateState(source, scratch);

    if (plate.hidden !== !scratch.visible) plate.hidden = !scratch.visible;
    if (!scratch.visible) return;

    const transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0) translate(-50%, -100%)`;
    if (plate.style.transform !== transform) plate.style.transform = transform;

    // Two decimals: the fade is a linear ramp over a second, so writing the raw float would
    // dirty the style on every frame for a change no one can see.
    const opacity = scratch.opacity >= 1 ? "" : scratch.opacity.toFixed(2);
    if (plate.style.opacity !== opacity) plate.style.opacity = opacity;

    if (distance.textContent !== scratch.distanceText) distance.textContent = scratch.distanceText;

    const width = `${Math.round(scratch.healthFraction * 100)}%`;
    if (fill.style.width !== width) fill.style.width = width;
  }

  dispose(): void {
    for (const plate of this.plates) plate.remove();
    this.plates.length = 0;
    this.fills.length = 0;
    this.distances.length = 0;
  }
}
