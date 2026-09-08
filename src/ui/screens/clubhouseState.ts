import {
  CHASSIS_PAINTS,
  TIRE_OPTIONS,
  TURRET_SKINS,
  slotColorsFor,
  tireTypeFor,
} from "../../sim/loadout";
import type { Loadout } from "../../sim/loadout";
import { CLUB_STATS, ClubType, computeLaunchVelocity } from "../../physics/Ballistics";
import type { TireType } from "../../sim/entities/Cart";

/**
 * Every decision the clubhouse makes, with no DOM. `ClubhouseScreen.ts` is the writer; this is
 * the part with logic worth testing, which is the same split `hudState.ts` uses.
 *
 * The model is **preview, then confirm**, because image 11 has a CONFIRM button. Clicking a
 * swatch repaints the cart on the turntable immediately and costs nothing; only CONFIRM spends
 * coins and equips. BACK throws the preview away. Anything else would charge a player for
 * looking.
 */

export type Category = "skin" | "paint" | "tire";

export class ClubhouseState {
  private readonly owned = new Set<string>();
  private equippedLoadout: Loadout;
  private previewLoadout: Loadout;
  private balance: number;

  constructor(equipped: Loadout, coins: number) {
    this.equippedLoadout = { ...equipped };
    this.previewLoadout = { ...equipped };
    this.balance = coins;
    // Whatever the player arrives wearing is theirs, as is anything priced at zero.
    for (const option of [...CHASSIS_PAINTS, ...TURRET_SKINS, ...TIRE_OPTIONS]) {
      if (option.price === 0) this.owned.add(option.id);
    }
    this.owned.add(equipped.paint);
    this.owned.add(equipped.skin);
    this.owned.add(equipped.tire);
  }

  get coins(): number {
    return this.balance;
  }

  get equipped(): Readonly<Loadout> {
    return this.equippedLoadout;
  }

  get preview(): Readonly<Loadout> {
    return this.previewLoadout;
  }

  /** True while the preview differs from what is equipped -- what lights up CONFIRM. */
  get dirty(): boolean {
    const a = this.equippedLoadout;
    const b = this.previewLoadout;
    return a.paint !== b.paint || a.skin !== b.skin || a.tire !== b.tire;
  }

  /** Slot -> colour for the previewed loadout. Handed straight to `GolfClub.setSlotColors`. */
  get previewColors(): Record<string, number> {
    return slotColorsFor(this.previewLoadout);
  }

  get previewTire(): TireType {
    return tireTypeFor(this.previewLoadout);
  }

  /** Total price of everything previewed but not yet owned. Zero once everything is owned. */
  get pendingCost(): number {
    return this.pendingPurchases().reduce((sum, o) => sum + o.price, 0);
  }

  owns(id: string): boolean {
    return this.owned.has(id);
  }

  /** Owned already, or cheap enough to buy right now. */
  affordable(category: Category, id: string): boolean {
    const option = find(category, id);
    if (!option) return false;
    return this.owned.has(id) || option.price <= this.balance;
  }

  /** Preview an option. Costs nothing; unknown ids are ignored rather than blanking the cart. */
  select(category: Category, id: string): void {
    if (!find(category, id)) return;
    this.previewLoadout = { ...this.previewLoadout, [category]: id };
  }

  /**
   * Buy anything previewed and not owned, then equip. Returns false and changes nothing if the
   * player cannot afford the lot -- a partial purchase would equip half a look and bill for it.
   */
  confirm(): boolean {
    const cost = this.pendingCost;
    if (cost > this.balance) return false;
    this.balance -= cost;
    for (const option of this.pendingPurchases()) this.owned.add(option.id);
    this.equippedLoadout = { ...this.previewLoadout };
    return true;
  }

  /** BACK: discard the preview and go back to what is equipped. */
  cancel(): void {
    this.previewLoadout = { ...this.equippedLoadout };
  }

  private pendingPurchases(): { id: string; price: number }[] {
    const wanted: [Category, string][] = [
      ["paint", this.previewLoadout.paint],
      ["skin", this.previewLoadout.skin],
      ["tire", this.previewLoadout.tire],
    ];
    const out: { id: string; price: number }[] = [];
    for (const [category, id] of wanted) {
      if (this.owned.has(id)) continue;
      const option = find(category, id);
      if (option) out.push({ id: option.id, price: option.price });
    }
    return out;
  }
}

function find(
  category: Category,
  id: string,
): { readonly id: string; readonly price: number } | undefined {
  const list =
    category === "paint" ? CHASSIS_PAINTS : category === "skin" ? TURRET_SKINS : TIRE_OPTIONS;
  return list.find((o) => o.id === id);
}

/* ------------------------------------------------------------------------------------------- */

export interface StatBar {
  readonly label: string;
  /** 0..1, ready to be a width. Always "more is better", whatever the underlying unit. */
  readonly value: number;
  /** The real quantity, for a tooltip or a readout beside the bar. */
  readonly detail: string;
}

export interface ClubStatCard {
  readonly club: ClubType;
  readonly label: string;
  readonly bars: readonly StatBar[];
}

const CLUB_ORDER: readonly ClubType[] = [ClubType.Putter, ClubType.Iron, ClubType.Driver];

/** Matches `GRAVITY` in `sim/world.ts`. Only used for the comparative range estimate below. */
const GRAVITY = 9.81;

/**
 * Image 11's three bars per club, derived from `CLUB_STATS` and never retyped.
 *
 * POWER and RELOAD read straight off the table. **RANGE is the careful one**: there is no `range`
 * field, and `sim/carry.ts` is explicit that distance is an emergent result of the ballistics
 * integration and must not become a second copy of the club stats. So it is *computed* -- the
 * launch velocity the game actually fires, put through the vacuum range formula
 * `v^2 * sin(2 * theta) / g`.
 *
 * That is a comparative figure, not a prediction: it ignores drag and roll-out, so it does not
 * match what `npm run probe` measures on the course. It does not need to. Its job is to rank
 * three clubs against each other on the same basis, and because it is derived from `loftDeg` and
 * `maxSpeed`, a balance change moves the bars instead of leaving them lying.
 */
export function clubStatCards(): readonly ClubStatCard[] {
  const ranges = new Map<ClubType, number>();
  for (const club of CLUB_ORDER) ranges.set(club, vacuumRange(club));

  const maxPower = Math.max(...CLUB_ORDER.map((c) => CLUB_STATS[c].maxSpeed));
  const maxRange = Math.max(...ranges.values());
  const slowestReload = Math.max(...CLUB_ORDER.map((c) => CLUB_STATS[c].reloadSeconds));

  return CLUB_ORDER.map((club) => {
    const stats = CLUB_STATS[club];
    const range = ranges.get(club) ?? 0;
    return {
      club,
      label: club.toUpperCase(),
      bars: [
        {
          label: "POWER",
          value: stats.maxSpeed / maxPower,
          detail: `${stats.maxSpeed} m/s`,
        },
        {
          label: "RANGE",
          value: maxRange === 0 ? 0 : range / maxRange,
          // Deliberately no number. The bar RANKS the clubs, which it does correctly, but the
          // vacuum model behind it cannot PREDICT a distance: it ignores drag and roll-out, and
          // roll is most of a putter's length. Printing "1 m" beside the putter -- which
          // `npm run probe` measures at 7.5 m -- would be a confident wrong answer where a bar
          // is an honest relative one. Image 11 draws these bars without numbers too.
          detail: "",
        },
        {
          // Inverted on purpose: a longer bar has to mean a better club, and a fast reload is
          // better. Drawing raw seconds would give the putter the shortest bar for its best stat.
          label: "RELOAD",
          value: slowestReload === 0 ? 0 : 1 - (stats.reloadSeconds - fastest()) / span(),
          detail: `${stats.reloadSeconds.toFixed(1)} s`,
        },
      ],
    };
  });

  function fastest(): number {
    return Math.min(...CLUB_ORDER.map((c) => CLUB_STATS[c].reloadSeconds));
  }
  function span(): number {
    return Math.max(1e-6, slowestReload - fastest());
  }
}

/**
 * Range in a vacuum for a club fired at full charge, using the same `computeLaunchVelocity` the
 * game fires with -- so loft and speed have exactly one definition between the card and the shot.
 */
function vacuumRange(club: ClubType): number {
  const v = computeLaunchVelocity(club, 1, 0);
  const horizontal = Math.hypot(v.x, v.z);
  // Time to return to launch height under gravity alone, times horizontal speed.
  return (2 * v.y * horizontal) / GRAVITY;
}
