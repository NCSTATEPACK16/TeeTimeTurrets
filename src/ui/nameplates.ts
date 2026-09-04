/**
 * A name pill and health bar over each cart -- BACKLOG #34b, images 07 and 09.
 *
 * The elements are built once and repositioned every frame, which is exactly how a nameplate
 * differs from a hit marker: UI-SPEC H11's markers are one-shot nodes that animate themselves
 * and are thrown away, and H13's plates persist. Positioned with `translate3d`, never
 * `left`/`top`, per UI-SPEC's projection rule.
 *
 * DOM only. The world->screen projection happens in `src/render/scene.ts`, which owns the
 * camera; this module never sees three.
 */

export class Nameplates {
  private readonly root: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly fills: HTMLElement[] = [];

  constructor(container: HTMLElement, labels: readonly string[]) {
    this.root = container;
    for (const label of labels) {
      const plate = document.createElement("div");
      plate.className = "nameplate";
      plate.hidden = true;

      const name = document.createElement("span");
      name.className = "nameplate-name";
      name.textContent = label;

      const track = document.createElement("div");
      track.className = "nameplate-track";
      const fill = document.createElement("div");
      fill.className = "nameplate-fill";
      track.appendChild(fill);

      plate.appendChild(name);
      plate.appendChild(track);
      this.root.appendChild(plate);
      this.plates.push(plate);
      this.fills.push(fill);
    }
  }

  /**
   * Places one plate. `visible` is false when the cart is behind the camera or off screen; the
   * plate is hidden rather than parked, so a plate never appears clamped to a screen edge.
   *
   * Every write is guarded against its current value: this runs per cart per frame at 60fps, and
   * an unguarded write dirties the DOM whether or not anything changed.
   */
  setPlate(index: number, screenX: number, screenY: number, visible: boolean, healthFraction: number): void {
    const plate = this.plates[index];
    const fill = this.fills[index];
    if (plate === undefined || fill === undefined) return;

    if (plate.hidden !== !visible) plate.hidden = !visible;
    if (!visible) return;

    const transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0) translate(-50%, -100%)`;
    if (plate.style.transform !== transform) plate.style.transform = transform;

    const width = `${Math.round(clamp01(healthFraction) * 100)}%`;
    if (fill.style.width !== width) fill.style.width = width;
  }

  dispose(): void {
    for (const plate of this.plates) plate.remove();
    this.plates.length = 0;
    this.fills.length = 0;
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
