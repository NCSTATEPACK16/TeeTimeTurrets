import type { HitEventKind } from "../sim/world";

/**
 * Hit markers (UI-SPEC H11, image 00): the little `+50` / `DIRECT HIT!` / `ENEMY DOWN` callouts
 * that pop at a hit's world position and drift up as they fade. Distinct from the event banner
 * (`banner.ts`): a marker is a one-shot node at a world-projected point that animates itself and is
 * thrown away; a banner is screen-anchored and dwells. Sharing one for the other is the wrong turn
 * UI-SPEC warns about.
 *
 * The world->screen projection is the render layer's (`RenderScene.projectToScreen`); this class is
 * handed pixel coordinates and only owns the DOM nodes: it spawns one per event, lets CSS drift and
 * fade it, and drops it on `animationend`. `dispose` clears any still in flight when the screen
 * tears down, per the AGENTS.md cleanup rule -- a marker mid-animation must not outlive its round.
 */

interface MarkerText {
  readonly label: string;
  /** A CSS modifier class, so a kill can read differently from a plain hit. */
  readonly variant: string;
}

const TEXT: Record<HitEventKind, MarkerText> = {
  hit: { label: "+50", variant: "hit-marker--hit" },
  kill: { label: "ENEMY DOWN", variant: "hit-marker--kill" },
};

export class HitMarkers {
  private readonly root: HTMLElement;
  /** Live nodes, so `dispose` can drop any still animating. A node removes itself on animationend
   *  and is spliced out here; the set is small (one tick's worth of hits at a time). */
  private readonly live = new Set<HTMLElement>();

  constructor(container: HTMLElement) {
    this.root = container;
  }

  /** Spawns one marker at a screen pixel position. `screenX/Y` come from `projectToScreen`. */
  spawn(kind: HitEventKind, screenX: number, screenY: number): void {
    const text = TEXT[kind];
    const node = document.createElement("div");
    node.className = `hit-marker ${text.variant}`;
    node.textContent = text.label;
    // left/top rather than the nameplate's translate3d: a marker's position is set once and never
    // touched again (it is a one-shot, not repositioned per frame), and leaving `transform` free
    // lets the CSS keyframe own the drift without fighting a positioning transform.
    node.style.left = `${Math.round(screenX)}px`;
    node.style.top = `${Math.round(screenY)}px`;

    const remove = (): void => {
      if (this.live.delete(node)) node.remove();
    };
    node.addEventListener("animationend", remove, { once: true });

    this.root.appendChild(node);
    this.live.add(node);
  }

  /** Drops every marker still in flight. Called on screen exit. */
  dispose(): void {
    for (const node of this.live) node.remove();
    this.live.clear();
  }
}
