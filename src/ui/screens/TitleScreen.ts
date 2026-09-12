import * as THREE from "three";
import { createBackdrop } from "../../render/backdrop";
import type { Backdrop } from "../../render/backdrop";
import { el, on } from "../dom";
import type { Screen } from "../../app/ScreenManager";
import type { HoleSpec } from "../../sim/course";

/**
 * Image 10. Logo top-left, a right-hand action stack with the primary in orange, a version string
 * bottom-right, and a live course scene turning slowly behind the panel at golden hour.
 *
 * Buttons for screens that do not exist yet are rendered **disabled, not absent** -- `ROADMAP.md`
 * asks for that specifically. A missing button hides the roadmap from the player; a dead one that
 * looks alive is worse. Disabled says "not yet" honestly.
 */

export interface TitleActions {
  readonly play: () => void;
  readonly arena?: () => void;
  readonly clubhouse?: () => void;
  readonly multiplayer?: () => void;
  readonly settings?: () => void;
}

export interface TitleScreenOptions {
  readonly root: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly backdropHole: HoleSpec;
  readonly version: string;
  readonly actions: TitleActions;
}

export class TitleScreen implements Screen {
  private readonly options: TitleScreenOptions;
  private backdrop: Backdrop | null = null;
  private container: HTMLElement | null = null;
  private readonly teardown: (() => void)[] = [];
  private lastFrameMs = 0;

  constructor(options: TitleScreenOptions) {
    this.options = options;
  }

  enter(): void {
    const { root, renderer, backdropHole, version, actions } = this.options;

    this.backdrop = createBackdrop(backdropHole);
    const size = renderer.getSize(new THREE.Vector2());
    this.backdrop.resize(size.x, size.y);

    const menu = el("div", { class: "title__menu" });
    const button = (label: string, action: (() => void) | undefined, primary: boolean): void => {
      const node = el("button", {
        class: `btn btn--wide${primary ? " btn--primary" : ""}`,
        type: "button",
        text: label,
        disabled: action === undefined,
        title: action === undefined ? "Not built yet" : "",
      });
      if (action) this.teardown.push(on(node, "click", action));
      menu.append(node);
    };

    button("PLAY", actions.play, true);
    // Second, under PLAY: arena is a whole mode, not a side door. It sits above CLUBHOUSE because
    // the clubhouse is something you visit between rounds and this is something you play.
    button("ARENA", actions.arena, false);
    button("CLUBHOUSE", actions.clubhouse, false);
    button("MULTIPLAYER", actions.multiplayer, false);
    button("SETTINGS", actions.settings, false);

    this.container = el("div", { class: "screen title" }, [
      el("div", { class: "title__brand" }, [
        el("div", { class: "title__logo", text: "TEE TIME" }),
        el("div", { class: "title__logo title__logo--alt", text: "TURRETS" }),
      ]),
      menu,
      el("div", { class: "title__version", text: version }),
    ]);
    root.append(this.container);

    this.lastFrameMs = performance.now();
  }

  step(): void {
    // Nothing simulated: the backdrop turns on wall time, which is what `draw` advances.
  }

  draw(): void {
    if (!this.backdrop) return;
    const now = performance.now();
    // Clamped: a backgrounded tab hands back a multi-second delta on its first frame, which would
    // snap the orbit round instead of resuming it.
    const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;

    this.backdrop.update(dt);
    this.options.renderer.render(this.backdrop.scene, this.backdrop.camera);
  }

  resize(width: number, height: number): void {
    this.backdrop?.resize(width, height);
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.backdrop?.dispose();
    this.backdrop = null;
    this.container?.remove();
    this.container = null;
  }
}
