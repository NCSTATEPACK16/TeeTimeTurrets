/**
 * Title and ride-select artwork as inline SVG strings (Clubhouse Sunset: pine, cream, sunset
 * stripes, ink outlines), shared with free drive's menus in drive/. The turret cart: driver at the
 * wheel, roof turret swinging an iron. Coordinates are the 1280 x 720 design stage. Inline strings,
 * not image files, so the title loads nothing and stays inside the zero-external-asset rule.
 */

const INK = '#142018';

/** The title screen's backdrop: striped sun, layered hills, pines, flag green, bunkers, a pond, mown fairway. */
export const TITLE_SCENE = `
<svg class="mn-fill" width="1280" height="720" viewBox="0 0 1280 720" aria-hidden="true">
  <circle cx="1010" cy="320" r="170" fill="#F6C343"/>
  <circle cx="1010" cy="320" r="128" fill="#F28C28"/>
  <circle cx="1010" cy="320" r="86" fill="#C84B31"/>
  <rect x="820" y="290" width="380" height="8" fill="#FBE7C6"/>
  <rect x="820" y="320" width="380" height="12" fill="#FBE7C6"/>
  <rect x="820" y="352" width="380" height="16" fill="#FBE7C6"/>
  <rect x="820" y="388" width="380" height="20" fill="#FBE7C6"/>
  <path d="M-400 450 C 180 400, 360 410, 560 440 S 940 390, 1680 420 L 1680 1000 L -400 1000 Z" fill="#6FA56A"/>
  <g fill="#1E4D2B">
    <polygon points="560,450 588,370 616,450"/><polygon points="600,452 634,350 668,452"/><polygon points="652,448 680,380 708,448"/>
    <polygon points="1130,430 1160,345 1190,430"/><polygon points="1172,436 1204,330 1236,436"/><polygon points="1222,432 1250,366 1278,432"/>
  </g>
  <path d="M-400 520 C 240 470, 520 500, 760 520 S 1100 480, 1680 500 L 1680 1000 L -400 1000 Z" fill="#2E7A43"/>
  <ellipse cx="860" cy="500" rx="74" ry="16" fill="#3DA35D"/>
  <line x1="872" y1="500" x2="872" y2="414" stroke="${INK}" stroke-width="5"/>
  <path class="mn-flag" d="M872 416 L920 430 L872 444 Z" fill="#C84B31" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <ellipse cx="806" cy="508" rx="24" ry="7" fill="#F2D8A0" stroke="${INK}" stroke-width="3"/>
  <ellipse cx="930" cy="506" rx="20" ry="6" fill="#F2D8A0" stroke="${INK}" stroke-width="3"/>
  <path d="M600 548 C 610 530, 700 524, 760 532 C 820 540, 822 560, 770 566 C 700 574, 590 568, 600 548 Z" fill="#F2D8A0" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M612 549 C 622 536, 700 531, 756 538 C 806 545, 806 557, 766 561 C 700 567, 604 562, 612 549 Z" fill="#4FA3A5"/>
  <path d="M650 546 h40 M712 552 h30 M676 557 h22" stroke="#BFE3E0" stroke-width="3" stroke-linecap="round"/>
  <path d="M-400 590 C 320 565, 760 575, 1680 585 L 1680 1000 L -400 1000 Z" fill="#3DA35D"/>
  <g fill="#4FB566"><path d="M-400 645 L1680 625 L1680 647 L-400 669 Z"/><path d="M-400 695 L1680 673 L1680 695 L-400 717 Z"/></g>
  <path d="M1040 618 C 1060 604, 1150 600, 1190 610 C 1222 618, 1210 632, 1170 634 C 1110 638, 1030 634, 1040 618 Z" fill="#F2D8A0" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M1070 620 q20 -6 40 0 M1130 616 q16 -5 32 0" stroke="#D9B97A" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>`;

/** Ride select's backdrop: the same world, sun to the right, lower hills behind the cards. */
export const RIDE_SCENE = `
<svg class="mn-fill" width="1280" height="720" viewBox="0 0 1280 720" aria-hidden="true">
  <circle cx="1120" cy="250" r="140" fill="#F6C343"/>
  <circle cx="1120" cy="250" r="104" fill="#F28C28"/>
  <circle cx="1120" cy="250" r="68" fill="#C84B31"/>
  <rect x="960" y="226" width="320" height="7" fill="#FBE7C6"/>
  <rect x="960" y="252" width="320" height="10" fill="#FBE7C6"/>
  <rect x="960" y="280" width="320" height="14" fill="#FBE7C6"/>
  <rect x="960" y="312" width="320" height="18" fill="#FBE7C6"/>
  <path d="M-400 380 C 200 340, 420 350, 640 372 S 1000 330, 1680 350 L 1680 1000 L -400 1000 Z" fill="#6FA56A"/>
  <path d="M-400 470 C 260 430, 560 450, 820 470 S 1120 440, 1680 455 L 1680 1000 L -400 1000 Z" fill="#2E7A43"/>
  <path d="M-400 600 C 320 580, 760 586, 1680 594 L 1680 1000 L -400 1000 Z" fill="#3DA35D"/>
</svg>`;

const cloud = (w: number, h: number, vb: string, d: string, left: number, top: number) =>
  `<svg width="${w}" height="${h}" viewBox="${vb}" style="position:absolute;left:${left}px;top:${top}px;overflow:visible" aria-hidden="true"><path d="${d}" fill="#FFF4DC" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/></svg>`;

export const CLOUDS = `<div class="mn-clouds">
  ${cloud(200, 84, '-10 -14 200 84', 'M24 62 C 4 62, 2 34, 26 32 C 26 10, 62 2, 78 20 C 92 0, 136 6, 136 32 C 160 28, 172 60, 148 62 Z', 0, 20)}
  ${cloud(150, 66, '-10 -12 150 66', 'M18 46 C 2 46, 2 24, 20 24 C 22 6, 50 0, 62 14 C 74 0, 108 6, 106 26 C 124 24, 130 46, 112 46 Z', 300, 0)}
  ${cloud(120, 54, '-10 -10 120 54', 'M14 36 C 2 36, 2 18, 16 18 C 18 4, 40 0, 50 12 C 60 0, 86 4, 84 20 C 98 18, 102 36, 88 36 Z', 560, 90)}
</div>`;

export interface CartArtOptions {
  /** Turret windmills and strikes (class names set the timing). */
  firing: boolean;
  /** Draw the roof turret at all (default true). Free drive's carts have none. */
  turret?: boolean;
  /** Wheels turn and the driver nods with the bumps. */
  driving: boolean;
  /** Speed lines behind the cart. */
  speedLines: boolean;
  label?: string;
}

/** The turret cart, side view facing right, in a 300 x 260 box (wheels touch y = 250). */
export function cartSvg(o: CartArtOptions): string {
  const a11y = o.label ? `role="img" aria-label="${o.label}"` : 'aria-hidden="true"';
  const wheel = (cx: number) =>
    `<g class="${o.driving ? 'mn-wheel' : ''}"><circle cx="${cx}" cy="226" r="24" fill="${INK}"/><circle cx="${cx}" cy="226" r="9" fill="#FFF4DC"/><rect x="${cx - 3}" y="205" width="6" height="9" rx="2" fill="#FFF4DC"/></g>`;
  return `<svg class="mn-cart" width="300" height="260" viewBox="0 0 300 260" ${a11y}>
  ${o.speedLines ? `<path d="M-6 176 h-26 M0 198 h-44 M-10 218 h-24" stroke="${INK}" stroke-width="5" stroke-linecap="round" opacity=".45"/>` : ''}
  <rect x="38" y="112" width="28" height="56" rx="9" fill="#1E4D2B" stroke="${INK}" stroke-width="4"/>
  <rect x="38" y="128" width="28" height="7" fill="#F6C343"/>
  <path d="M44 112 l-4 -16 M52 112 l0 -20 M60 112 l4 -15" stroke="#7A8088" stroke-width="4" stroke-linecap="round"/>
  <path d="M34 96 h10 M46 90 h10 M60 96 h10" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <line x1="58" y1="196" x2="58" y2="78" stroke="#5A6470" stroke-width="7"/>
  <line x1="228" y1="160" x2="242" y2="78" stroke="#5A6470" stroke-width="7"/>
  <rect x="26" y="194" width="262" height="26" rx="11" fill="#1E4D2B" stroke="${INK}" stroke-width="4"/>
  <rect x="30" y="160" width="86" height="40" rx="9" fill="#FFF4DC" stroke="${INK}" stroke-width="4"/>
  <rect x="98" y="118" width="18" height="50" rx="6" fill="#FFF4DC" stroke="${INK}" stroke-width="4"/>
  <rect x="98" y="156" width="70" height="12" rx="5" fill="#F28C28" stroke="${INK}" stroke-width="3.5"/>
  <path d="M178 200 L178 170 Q178 158 192 158 L252 158 Q278 158 284 184 L286 200 Z" fill="#FFF4DC" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <rect x="268" y="168" width="12" height="9" rx="3" fill="#F6C343" stroke="${INK}" stroke-width="2.5"/>
  <rect x="112" y="190" width="70" height="10" fill="#FFF4DC" stroke="${INK}" stroke-width="3"/>
  <g class="${o.driving ? 'mn-nod' : ''}">
    <path d="M142 152 L182 160 L188 192" fill="none" stroke="#C9B48A" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="124" y="104" width="34" height="50" rx="13" fill="#F28C28" stroke="${INK}" stroke-width="4"/>
    <path d="M152 116 L200 134" stroke="#E8B98A" stroke-width="7" stroke-linecap="round"/>
    <circle cx="143" cy="88" r="13" fill="#E8B98A" stroke="${INK}" stroke-width="3.5"/>
    <path d="M129 84 a14 14 0 0 1 28 0 h10 v5 h-38 z" fill="#1E4D2B" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  </g>
  <line x1="214" y1="166" x2="202" y2="134" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="201" cy="132" rx="5" ry="14" fill="none" stroke="${INK}" stroke-width="5" transform="rotate(-20 201 132)"/>
  ${wheel(70)}
  ${wheel(236)}
  <rect x="34" y="66" width="226" height="15" rx="5" fill="#FFF4DC" stroke="${INK}" stroke-width="4"/>
  <rect x="38" y="75" width="218" height="2.5" fill="#F28C28"/>
  ${o.turret === false ? "" : `<path d="M132 66 L136 50 L166 50 L170 66 Z" fill="#7A8088" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
  <g class="${o.firing ? 'mn-arm' : ''}">
    <circle cx="150" cy="38" r="132" fill="none"/>
    <line x1="150" y1="38" x2="262" y2="38" stroke="#7A8088" stroke-width="7" stroke-linecap="round"/>
    <rect x="176" y="33" width="14" height="10" rx="3" fill="#5A6470"/>
    <path d="M258 30 L274 30 Q280 30 280 38 L278 54 Q277 58 272 58 L262 56 Z" fill="#C7CDD2" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
  </g>
  <rect x="124" y="22" width="56" height="30" rx="8" fill="#C84B31" stroke="${INK}" stroke-width="4"/>
  <circle cx="150" cy="38" r="7" fill="#7A8088" stroke="${INK}" stroke-width="3"/>`}
  ${
    o.firing
      ? `<circle class="mn-feed" cx="264" cy="94" r="7" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/>
  <g class="mn-flash"><path d="M266 94 l10 -26 l6 20 l22 -10 l-12 18 l24 6 l-24 6 l12 18 l-22 -10 l-6 20 l-10 -26 l-6 0 z" fill="#F28C28" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="278" cy="94" r="9" fill="#FFF4DC"/></g>`
      : ''
  }
</svg>`;
}

/** Balls the turret has struck: each flies an arc with an orange streak, one per swing. */
export function ballsHtml(count: number, swingSeconds: number, contactAt: number): string {
  let out = '';
  for (let k = 0; k < count; k++) {
    const delay = (swingSeconds * contactAt + k * swingSeconds).toFixed(3);
    out += `<div class="mn-ball-x" style="animation-delay:${delay}s"><div class="mn-ball-y" style="animation-delay:${delay}s"><div class="mn-ball"><div class="mn-ball-streak"></div><div class="mn-ball-core"></div></div></div></div>`;
  }
  return out;
}

/** The flag icon used on the Tee Off buttons. */
export const FLAG_ICON = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V3"/><path d="M6 4l11 4-11 4"/></svg>`;
