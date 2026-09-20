import type { BannerView } from "./bannerFeed";

/**
 * The DOM-writing half of the event banner. Every rule -- which event wins, how long it dwells,
 * how it fades -- lives in `bannerFeed.ts` and is node-tested; this file only writes the result to
 * elements and toggles one `hidden` flag, the same split `hud.ts`/`hudState.ts` and
 * `matchResults.ts`/`matchResultsState.ts` already use. It has no tests, so `npm run smoke` (or a
 * human) is what notices an element wired to nothing.
 */

export interface BannerDom {
  root: HTMLElement;
  headline: HTMLElement;
  consequence: HTMLElement;
}

export function readBanner(): BannerDom | null {
  const ids = ["event-banner", "banner-headline", "banner-consequence"] as const;
  const found = ids.map((id) => document.getElementById(id));
  if (found.some((element) => element === null)) return null;
  const [root, headline, consequence] = found as HTMLElement[];
  return { root: root!, headline: headline!, consequence: consequence! };
}

export function drawBanner(dom: BannerDom, view: BannerView): void {
  dom.root.hidden = !view.visible;
  if (!view.visible) return;
  if (dom.headline.textContent !== view.headline) dom.headline.textContent = view.headline;
  if (dom.consequence.textContent !== view.consequence) {
    dom.consequence.textContent = view.consequence;
  }
  // Opacity carries the fade; the element stays in the layout so the text does not reflow as it
  // goes. `toFixed` keeps the style string stable enough that identical frames do not thrash it.
  dom.root.style.opacity = view.opacity.toFixed(3);
}
