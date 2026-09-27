import type { Screen } from "../../app/ScreenManager";
import type { Settings } from "../../app/settings";
import { el, on } from "../dom";
import { buildSettingsPanel } from "../settingsPanel";

export interface SettingsScreenOptions {
  readonly root: HTMLElement;
  readonly settings: () => Settings;
  readonly onChange: (next: Settings) => void;
  readonly onBack: () => void;
}

/** The title's SETTINGS: the same panel the pause overlay carries, on its own screen. */
export class SettingsScreen implements Screen {
  private container: HTMLElement | null = null;
  private readonly teardown: (() => void)[] = [];

  constructor(private readonly options: SettingsScreenOptions) {}

  enter(): void {
    const panel = buildSettingsPanel(this.options.settings(), this.options.onChange);
    this.teardown.push(panel.dispose);
    const back = el("button", { class: "btn btn--primary btn--wide", type: "button", text: "BACK" });
    this.teardown.push(on(back, "click", () => this.options.onBack()));
    this.container = el("div", { class: "screen screen--scrim settings-screen" }, [
      el("div", { class: "panel settings-screen__panel" }, [el("h1", { class: "settings-screen__title", text: "SETTINGS" }), panel.root, back]),
    ]);
    this.options.root.append(this.container);
  }

  step(): void {}

  draw(): void {}

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.container?.remove();
    this.container = null;
  }
}
