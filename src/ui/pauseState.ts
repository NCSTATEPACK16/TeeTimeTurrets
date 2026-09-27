/**
 * Whether a match is frozen, and which card is up. DOM-free so the rules are tested in node;
 * `MatchScreen` owns the elements and simply does not step the sim while `paused`.
 *
 * - A first match opens on the controls card and stays frozen until it is dismissed.
 * - Esc toggles the pause menu. While the pointer is locked, the browser spends Esc on releasing
 *   the lock and the page never sees the key, so losing the lock mid-match pauses too.
 * - A finished match does not pause: its results screen is already coming up.
 */

export type PausePanel = "none" | "controls" | "pause";

export class PauseState {
  panel: PausePanel;

  constructor(options: { showControls: boolean }) {
    this.panel = options.showControls ? "controls" : "none";
  }

  get paused(): boolean {
    return this.panel !== "none";
  }

  escape(matchOver: boolean): void {
    if (matchOver || this.panel === "controls") return;
    this.panel = this.panel === "pause" ? "none" : "pause";
  }

  pointerLockLost(matchOver: boolean): void {
    if (matchOver || this.panel !== "none") return;
    this.panel = "pause";
  }

  resume(): void {
    if (this.panel === "pause") this.panel = "none";
  }

  dismissControls(): void {
    if (this.panel === "controls") this.panel = "none";
  }
}
