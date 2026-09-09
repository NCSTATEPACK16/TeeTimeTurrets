/**
 * H17, the pin marker: a small chip over the flagstick, labelled with metres from the ball to the
 * cup. UI-SPEC §2.
 *
 * It exists because the flagstick is modelled at true scale. A real pin is a shade over 2.1 m, and
 * from a tee 90 m away that is a few pixels of white against a treeline -- correct, and useless. The
 * marker is what makes the target findable, and it closes a second gap on the way: there was no
 * distance readout anywhere in the game, which is its own hole in a golf game.
 *
 * **Clamped to the screen edge rather than hidden when the pin is off camera**, which is the one way
 * it differs from H13's nameplates. A plate for a cart you cannot see is noise; an arrow-less
 * pointer at the edge of frame saying `84 m` is how you find the hole again after a wild drive.
 *
 * DOM only. The world->screen projection belongs to `src/render/scene.ts`, which owns the camera;
 * nothing here sees three.
 */

export class PinMarker {
  private readonly element: HTMLElement;
  private readonly label: HTMLElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "pin-marker";
    this.element.id = "pin-marker";

    this.label = document.createElement("span");
    this.label.className = "pin-marker-distance";
    this.label.id = "pin-marker-distance";

    const flag = document.createElement("span");
    flag.className = "pin-marker-icon";
    flag.textContent = "⛳";

    this.element.appendChild(flag);
    this.element.appendChild(this.label);
    container.appendChild(this.element);
  }

  /**
   * Places the marker. `onScreen` is false when the pin is behind the camera or outside the
   * frustum, in which case `screenX`/`screenY` are already clamped to the viewport edge by
   * `RenderScene.projectPinMarker` -- so this positions it either way and only changes how it looks.
   *
   * Every write is guarded against its current value: this runs once per frame at 60fps, and an
   * unguarded write dirties the DOM whether or not anything changed.
   */
  set(screenX: number, screenY: number, onScreen: boolean, distanceText: string): void {
    const transform = `translate3d(${Math.round(screenX)}px, ${Math.round(screenY)}px, 0) translate(-50%, -100%)`;
    if (this.element.style.transform !== transform) this.element.style.transform = transform;
    if (this.label.textContent !== distanceText) this.label.textContent = distanceText;

    // Dimmed at the edge, so "the pin is over there" reads differently from "the pin is there".
    const edged = onScreen ? "false" : "true";
    if (this.element.dataset.edged !== edged) this.element.dataset.edged = edged;
  }

  dispose(): void {
    this.element.remove();
  }
}
