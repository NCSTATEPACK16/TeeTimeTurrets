import type { Settings } from "../app/settings";
import { el, on } from "./dom";
import { buildControlsList, buildSettingsPanel } from "./settingsPanel";

/**
 * The match's pause overlay, in two modes:
 * - `"paused"`: RESUME, the settings panel, the controls, and MAIN MENU;
 * - `"controls"`: the first-play card -- the controls and a START button.
 *
 * Built into the `#screens` layer, above the HUD (UI rule from `docs/TEST-AND-SPEC-PITFALLS.md` §5:
 * a modal has an explicit stacking layer and is never covered by the HUD). The match screen owns
 * whether the sim is paused; this only shows and hides.
 */
export type PauseMode = "paused" | "controls";

export interface PauseHandlers {
  readonly resume: () => void;
  readonly mainMenu: () => void;
  readonly settingsChanged: (next: Settings) => void;
}

export class PauseOverlay {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly settingsSlot: HTMLElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly menuButton: HTMLButtonElement;
  private panel: { root: HTMLElement; dispose: () => void } | null = null;
  private readonly teardown: (() => void)[] = [];
  private currentMode: PauseMode | null = null;

  constructor(
    container: HTMLElement,
    private readonly settings: () => Settings,
    private readonly handlers: PauseHandlers,
  ) {
    this.title = el("h1", { class: "pause__title" });
    this.settingsSlot = el("div", { class: "pause__settings" });
    this.resumeButton = el("button", { class: "btn btn--primary btn--wide", type: "button" });
    this.menuButton = el("button", { class: "btn btn--wide", type: "button", text: "MAIN MENU" });
    this.teardown.push(on(this.resumeButton, "click", () => this.handlers.resume()));
    this.teardown.push(on(this.menuButton, "click", () => this.handlers.mainMenu()));
    this.root = el("div", { class: "screen screen--scrim pause", attrs: { id: "pause-overlay" } }, [
      el("div", { class: "panel pause__panel" }, [
        this.title,
        this.settingsSlot,
        buildControlsList(),
        el("div", { class: "pause__actions" }, [this.resumeButton, this.menuButton]),
      ]),
    ]);
    this.root.hidden = true;
    container.append(this.root);
  }

  get mode(): PauseMode | null {
    return this.currentMode;
  }

  show(mode: PauseMode): void {
    this.currentMode = mode;
    this.title.textContent = mode === "paused" ? "PAUSED" : "HOW TO PLAY";
    this.resumeButton.textContent = mode === "paused" ? "RESUME" : "START";
    this.menuButton.hidden = mode !== "paused";
    this.panel?.dispose();
    this.panel = null;
    this.settingsSlot.replaceChildren();
    if (mode === "paused") {
      this.panel = buildSettingsPanel(this.settings(), this.handlers.settingsChanged);
      this.settingsSlot.append(this.panel.root);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.currentMode = null;
    this.root.hidden = true;
    this.panel?.dispose();
    this.panel = null;
    this.settingsSlot.replaceChildren();
  }

  dispose(): void {
    this.hide();
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.root.remove();
  }
}
