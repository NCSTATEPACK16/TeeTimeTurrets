import * as THREE from "three";
import { createShowroom } from "../../render/showroom";
import type { Showroom } from "../../render/showroom";
import { ClubhouseState, clubStatCards } from "./clubhouseState";
import type { Category } from "./clubhouseState";
import { CHASSIS_PAINTS, TIRE_OPTIONS, TURRET_SKINS } from "../../sim/loadout";
import type { Loadout } from "../../sim/loadout";
import { ClubType } from "../../physics/Ballistics";
import { el, on } from "../dom";
import type { Screen } from "../../app/ScreenManager";

/**
 * Image 11. The cart on a lit turntable, a left-hand category list of `TURRET SKIN` /
 * `CHASSIS PAINT` / `TIRE TYPE` with swatch columns, a right-hand column of per-club
 * `POWER` / `RANGE` / `RELOAD` cards, the coin balance, and `BACK` / `CONFIRM`.
 *
 * Every decision lives in `clubhouseState.ts`, which is tested in the node environment; this
 * class reads that and writes DOM. Selecting a swatch repaints the live cart through one
 * material write per slot -- no rebuild, no second mesh -- which is what the eight material slots
 * in `ASSET_PIPELINE.md` section 2.1 were for.
 */

const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: "skin", label: "TURRET SKIN" },
  { id: "paint", label: "CHASSIS PAINT" },
  { id: "tire", label: "TIRE TYPE" },
];

export interface ClubhouseScreenOptions {
  readonly root: HTMLElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly loadout: Loadout;
  readonly coins: number;
  /** Called on CONFIRM with the equipped loadout and the coins left. */
  readonly onConfirm: (loadout: Loadout, coins: number) => void;
  readonly onBack: () => void;
}

export class ClubhouseScreen implements Screen {
  private readonly options: ClubhouseScreenOptions;
  private readonly teardown: (() => void)[] = [];
  private state: ClubhouseState;
  private showroom: Showroom | null = null;
  private container: HTMLElement | null = null;
  private coinValue: HTMLElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;
  private readonly swatchNodes = new Map<string, HTMLButtonElement>();
  private lastFrameMs = 0;
  private club = ClubType.Driver;

  constructor(options: ClubhouseScreenOptions) {
    this.options = options;
    this.state = new ClubhouseState(options.loadout, options.coins);
  }

  enter(): void {
    const { root, renderer } = this.options;

    this.showroom = createShowroom(this.club, this.state.previewColors);
    const size = renderer.getSize(new THREE.Vector2());
    this.showroom.resize(size.x, size.y);

    this.container = el("div", { class: "screen clubhouse" }, [
      this.buildCategories(),
      this.buildCoins(),
      this.buildClubCards(),
      this.buildActions(),
    ]);
    root.append(this.container);
    this.refresh();
    this.lastFrameMs = performance.now();
  }

  step(): void {
    // Nothing simulated. The turntable turns on wall time in `draw`.
  }

  draw(): void {
    if (!this.showroom) return;
    const now = performance.now();
    // Clamped: a backgrounded tab returns a multi-second delta and would spin the cart wildly.
    const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;
    this.showroom.update(dt);
    this.options.renderer.render(this.showroom.scene, this.showroom.camera);
  }

  resize(width: number, height: number): void {
    this.showroom?.resize(width, height);
  }

  exit(): void {
    for (const off of this.teardown) off();
    this.teardown.length = 0;
    this.swatchNodes.clear();
    this.showroom?.dispose();
    this.showroom = null;
    this.container?.remove();
    this.container = null;
    this.coinValue = null;
    this.confirmButton = null;
  }

  // --- building -------------------------------------------------------------------------------

  private buildCategories(): HTMLElement {
    const list = el("div", { class: "clubhouse__categories" });

    for (const category of CATEGORIES) {
      const swatches = el("div", { class: "swatches" });
      for (const option of optionsFor(category.id)) {
        const node = el("button", {
          class: "swatch",
          type: "button",
          title: `${option.label} — ${option.price === 0 ? "owned" : `${option.price} coins`}`,
          style: { background: hex(option.swatch) },
        });
        this.teardown.push(
          on(node, "click", () => {
            this.state.select(category.id, option.id);
            this.refresh();
          }),
        );
        this.swatchNodes.set(option.id, node);
        swatches.append(node);
      }

      list.append(
        el("div", { class: "clubhouse__category" }, [
          el("span", { class: "clubhouse__category-label", text: category.label }),
          swatches,
        ]),
      );
    }
    return list;
  }

  private buildCoins(): HTMLElement {
    this.coinValue = el("span", { text: String(this.state.coins) });
    return el("div", { class: "clubhouse__coins" }, [
      el("span", { class: "chip" }, [el("span", { class: "chip__coin", text: "◉" }), this.coinValue]),
    ]);
  }

  /**
   * Image 11's right-hand column. Clicking a card swaps the club on the turntable, which is the
   * only way to see the three club heads the graph carries.
   */
  private buildClubCards(): HTMLElement {
    const column = el("div", { class: "clubhouse__clubs" });
    for (const card of clubStatCards()) {
      const bars = card.bars.map((bar) =>
        el("div", { class: "club-card__row" }, [
          el("span", { class: "club-card__stat", text: bar.label }),
          el("div", { class: "meter" }, [
            el("div", { class: "meter__fill", style: { width: `${Math.round(bar.value * 100)}%` } }),
          ]),
          el("span", { class: "club-card__detail", text: bar.detail }),

        ]),
      );

      const node = el("button", { class: "club-card", type: "button" }, [
        el("span", { class: "club-card__name", text: card.label }),
        el("div", { class: "club-card__bars" }, bars),
      ]);
      this.teardown.push(
        on(node, "click", () => {
          this.club = card.club;
          this.showroom?.setClub(card.club);
          this.refresh();
        }),
      );
      column.append(node);
    }
    return column;
  }

  private buildActions(): HTMLElement {
    const back = el("button", { class: "btn", type: "button", text: "BACK" });
    this.teardown.push(
      on(back, "click", () => {
        // BACK discards the preview rather than silently keeping it: a player who backs out of
        // the clubhouse expects to leave wearing what they arrived in.
        this.state.cancel();
        this.options.onBack();
      }),
    );

    this.confirmButton = el("button", { class: "btn btn--primary", type: "button", text: "CONFIRM" });
    this.teardown.push(
      on(this.confirmButton, "click", () => {
        if (!this.state.confirm()) return;
        this.options.onConfirm({ ...this.state.equipped }, this.state.coins);
        this.refresh();
      }),
    );

    return el("div", { class: "clubhouse__actions" }, [back, this.confirmButton]);
  }

  // --- syncing --------------------------------------------------------------------------------

  /** One place that pushes state into the DOM and the scene, so they cannot disagree. */
  private refresh(): void {
    this.showroom?.setSlotColors(this.state.previewColors);

    const preview = this.state.preview;
    for (const category of CATEGORIES) {
      for (const option of optionsFor(category.id)) {
        const node = this.swatchNodes.get(option.id);
        if (!node) continue;
        node.classList.toggle("swatch--on", preview[category.id] === option.id);
        // Unaffordable options stay visible but unclickable -- the player can see what the
        // clubhouse sells before they can buy it.
        node.disabled = !this.state.affordable(category.id, option.id);
      }
    }

    if (this.coinValue) this.coinValue.textContent = String(this.state.coins);
    if (this.confirmButton) {
      const cost = this.state.pendingCost;
      this.confirmButton.textContent = cost > 0 ? `CONFIRM — ${cost}` : "CONFIRM";
      this.confirmButton.disabled = !this.state.dirty || cost > this.state.coins;
    }

    for (const node of this.container?.querySelectorAll(".club-card") ?? []) {
      const name = node.querySelector(".club-card__name")?.textContent ?? "";
      node.classList.toggle("club-card--on", name === this.club.toUpperCase());
    }
  }
}

function optionsFor(
  category: Category,
): readonly { readonly id: string; readonly label: string; readonly price: number; readonly swatch: number }[] {
  if (category === "paint") return CHASSIS_PAINTS;
  if (category === "skin") return TURRET_SKINS;
  return TIRE_OPTIONS;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
