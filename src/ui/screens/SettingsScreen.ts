import type { Screen } from "../../app/ScreenManager";
import type { Settings } from "../../app/settings";
import { el } from "../dom";
import { buildSettingsPanel } from "../settingsPanel";

export interface SettingsScreenOptions {
  readonly root: HTMLElement;
  readonly settings: Settings;
  readonly onChange: (next: Settings) => void;
  readonly onBack: () => void;
}

/** The title menu's SETTINGS: the shared settings panel and a way back. */
export class SettingsScreen implements Screen {
  private container: HTMLElement | null = null;

  constructor(private readonly options: SettingsScreenOptions) {}

  enter(): void {
    const back = el("button", { class: "btn btn--primary btn--wide", type: "button", text: "BACK" });
    back.addEventListener("click", () => this.options.onBack());
    this.container = el("div", { class: "screen screen--scrim settings-screen" }, [
      el("div", { class: "panel settings-screen__panel" }, [
        el("h1", { class: "settings-screen__title", text: "SETTINGS" }),
        buildSettingsPanel(this.options.settings, this.options.onChange),
        back,
      ]),
    ]);
    this.options.root.appendChild(this.container);
  }

  step(): void {}

  draw(): void {}

  exit(): void {
    this.container?.remove();
    this.container = null;
  }
}
