
import type { DamageFlash } from "./damageFlash";
import { KILL_FEED_LINES, KILL_FEED_SECONDS } from "./killFeed";
import type { KillFeedLine } from "./killFeed";

/**
 * The DOM half of the kill feed and the damage flash. Every row and wedge is built once, when the
 * match screen enters, and rewritten in place every frame; `dispose` removes them. The rules are in
 * `killFeed.ts` and `damageFlash.ts`, which are tested; this only puts them on screen, and
 * `npm run smoke` is what notices if it puts them nowhere.
 */

/** The last second of a kill line's life is its fade. */
const KILL_LINE_FADE_S = 1;

interface KillRow {
  root: HTMLElement;
  killer: HTMLElement;
  verb: HTMLElement;
  victim: HTMLElement;
}

export class KillFeedDom {
  private readonly rows: KillRow[] = [];

  constructor(container: HTMLElement) {
    for (let i = 0; i < KILL_FEED_LINES; i++) {
      const root = document.createElement("div");
      root.className = "kill-line";
      root.hidden = true;
      const killer = document.createElement("span");
      const verb = document.createElement("span");
      const victim = document.createElement("span");
      root.append(killer, verb, victim);
      container.appendChild(root);
      this.rows.push({ root, killer, verb, victim });
    }
  }

  draw(lines: readonly KillFeedLine[]): void {
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      const line = lines[i];
      if (line === undefined) {
        if (!row.root.hidden) row.root.hidden = true;
        continue;
      }
      row.root.hidden = false;
      if (line.killer === null) {
        setText(row.killer, "");
        setText(row.verb, "");
        setText(row.victim, `${line.victim} DROWNED`);
      } else {
        setText(row.killer, line.killer);
        setClass(row.killer, `kill-name--${line.killerSide}`);
        setText(row.verb, " ▸ ");
        setText(row.victim, line.victim);
      }
      setClass(row.victim, `kill-name--${line.victimSide}`);
      const fade = Math.min(1, (KILL_FEED_SECONDS - line.age) / KILL_LINE_FADE_S);
      setOpacity(row.root, fade);
    }
  }

  dispose(): void {
    for (const row of this.rows) row.root.remove();
    this.rows.length = 0;
  }
}

export class DamageFlashDom {
  private readonly wedges: HTMLElement[] = [];

  constructor(container: HTMLElement, count = 4) {
    for (let i = 0; i < count; i++) {
      const wedge = document.createElement("div");
      wedge.className = "damage-wedge";
      container.appendChild(wedge);
      this.wedges.push(wedge);
    }
  }

  draw(flashes: readonly DamageFlash[]): void {
    for (let i = 0; i < this.wedges.length; i++) {
      const wedge = this.wedges[i]!;
      const flash = flashes[i];
      if (flash === undefined) {
        setOpacity(wedge, 0);
        continue;
      }
      wedge.style.transform = `rotate(${flash.bearing.toFixed(3)}rad)`;
      setOpacity(wedge, flash.alpha);
    }
  }

  dispose(): void {
    for (const wedge of this.wedges) wedge.remove();
    this.wedges.length = 0;
  }
}

/** Exported for the vignette, which the HUD writes. Rounded so a value that has not moved in the
 *  third decimal does not dirty the style. */
export function setOpacity(element: HTMLElement, value: number): void {
  const v = Math.max(0, Math.min(1, value)).toFixed(3);
  if (element.style.opacity !== v) element.style.opacity = v;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function setClass(element: HTMLElement, className: string): void {
  if (element.className !== className) element.className = className;
}

