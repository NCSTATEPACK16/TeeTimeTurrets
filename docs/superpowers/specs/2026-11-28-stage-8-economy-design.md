# Stage 8: the economy

Written 2026-11-28. The spec for `docs/REVAMP-PLAN.md`, "Stage 8: economy". Stage 7 needs a local
Blender session, so it is skipped for now. As with Stages 5 and 6, the user asked for the build
straight after the spec, so every question in §8 is built to its default. The play-test is where a
default gets overturned.

What the plan asked for, and where each item lands:

| Plan item | Here |
|---|---|
| `sim/scoring.ts`: score, coins, XP and `xpToNext` | §2, slice 1 |
| `app/profile.ts`: localStorage, versioned, schema-guarded, a new profile at 0 coins | §3, slice 3 |
| It fixes the owned-items bug in `clubhouseState.ts` | §3.3, slice 3 |
| `UPGRADES`: armour, ammo capacity, reload, tyres, the driver at level 2; `applyLoadout` is the only place stats change | §4, slice 2 (the clubhouse column, slice 3) |
| Loadouts for every rig, so paint and skin render in the match | §5, slice 4 |
| `MatchResultsScreen` after each match | §3.4, slice 3 |
| BACKLOG #49: no chassis paints in team hues | §5.2, slice 4 |

---

## 1. What exists today

Read from `main` at `d475f27`.

- **Coins and the loadout live only for the page.** `main.ts` holds `let loadout` and
  `let coins = STARTING_COINS` (6000). A reload resets both.
- **The owned-items bug.** `new ClubhouseState(equipped, coins)` rebuilds `owned` from the
  free options plus whatever is equipped. Buy Sunset, then Fairway, and leave: next visit, Sunset is
  for sale again.
- **`scoring.ts`** holds two constants, `SCORE_PER_DAMAGE` (10) and `SCORE_PER_KILL` (100). Only
  the hit markers read them (`hitFeedback.ts`).
- **The match keeps kills** per cart (`Match.points`) and the winner (`winningTeam()`). Damage,
  pickups and assists are not tallied anywhere. The event log has `hit` and `ram` (damage dealt),
  `kill` and `pickup`, each with the actor, but nothing in `src/sim/**` reads the log back.
- **Only the tyre reaches the match.** `Sim.create(..., { tire })`. Paint and skin show on the
  clubhouse turntable and nowhere else: `scene.ts` sets every cart's team canopy and shirt, and no
  loadout colours.
- **Per-cart stats are constants.** `ARENA_MAX_HEALTH` 8 (an option on `Cart`), `MAX_AMMO` 100
  and `CLUB_STATS[club].reloadSeconds`, read in `Cart.fire`. The player starts on the driver.

## 2. Scoring (slice 1)

### 2.1 The tally

New `MatchTally` in `src/sim/scoring.ts`, owned by `Sim` as `sim.tally` and cleared in `Sim.reset`.
Typed arrays, one slot per cart, preallocated: no allocation in the tick.

- **Damage:** every point of `hit` and `ram` damage the cart dealt to an **enemy** (shield-blocked
  hits deal 0, so they count 0). Mortar splash counts as a hit. Friendly fire and self-damage
  count nothing.
- **Kills:** enemy kills only, the same rule `Match.scoreKill` pays by.
- **Assists** (Q1): a cart that damaged the victim within the **5 s** before a teammate's kill. One
  per kill per cart, never to the killer. A kill with no killer (water, the zone) still pays assists
  to whoever damaged the victim, because they put it there.
- **Pickups:** every bucket, hot dog and drink the cart took from a site (Q10). A loose ball
  picked off the ground does not count: driving over spent rounds is how a cart reloads, and at
  15 points a ball it would out-earn the kills.

It is written at the same places those events are pushed (`creditHit`, the ram callback,
`killCart`, the pickup paths), so the tally and the log cannot disagree.

### 2.2 The formulas

```
score   = 100·kills + 40·assists + 10·damage + 15·pickups + 250·won
coins   = floor(score / 2)
xp      = score
xpToNext(level) = 500 + 250·level
```

- `won` is 1 when the cart's team won, 0 on a loss or a draw (Q2).
- `matchEarnings(tally, match, cart, out)` writes `{ score, coins, xp, kills, assists, damage,
  pickups, won }` into a caller's object.
- `addXp(level, xp, gained)` returns the new level and XP, carrying over any number of level-ups.
  Levels start at 1.

Both functions are pure, so the results screen and the test share them.

### 2.3 The golden

The tally only counts. It changes nothing in the match, so the golden is unchanged in every slice
(§4.4).

## 3. The profile (slice 3)

### 3.1 What it holds

New `src/app/profile.ts`, after `src/app/settings.ts`'s pattern: a `Store` handed in,
`pageStorage()` in the game, an in-memory store in tests.

```ts
interface Profile {
  coins: number;       // a new profile: 0
  xp: number;          // into the current level
  level: number;       // from 1
  owned: string[];     // option and upgrade-tier ids
  loadout: Loadout;    // paint, skin, tyre
  upgrades: { armor: number; ammo: number; reload: number };  // tiers, 0 = none
}
```

- **Key:** `teetimeturrets.profile`, with `version: 1`.
- **Schema-guarded, field by field.** A missing or wrongly typed field takes its default. An
  owned id that no longer exists is dropped. An equipped id that is not owned falls back to the
  free option. An upgrade tier is clamped to the table. A blob from an unknown version is ignored
  whole, and a corrupt one too.
- **Saved** after every purchase and after every match's earnings.
- **A new profile starts at 0 coins** (as the plan says). `STARTING_COINS` goes.

### 3.2 Dev grant

`?coins=N` on the URL adds N coins to the profile once, on load, so a play-tester can try the
shop without grinding (Q3). It is a dev convenience and says so in `main.ts`.

### 3.3 The owned-items fix

`ClubhouseState` is built from the profile, owned set and all, and hands the updated profile
back on CONFIRM. The free options are always owned; nothing else is assumed.

### 3.4 After each match

- On the match's end, `main.ts` computes the player's earnings once, adds the coins and the XP to
  the profile and saves it.
- `MatchResultsScreen` gains an earnings block under the roster:
  `+SCORE`, `+COINS`, and the level with an XP bar. When the match levelled the player up, a
  `LEVEL n` line says so, and on reaching level 2 it says the driver is unlocked.
- PLAY AGAIN replays the match (`Sim.reset`) and earns again at its end; the profile is credited
  once per finished match, never on entering the screen twice.

## 4. Upgrades (slice 2; the clubhouse column in slice 3)

### 4.1 The table

New `src/sim/upgrades.ts` (DOM-free; the match reads it) holds `UPGRADES`:

| Upgrade | Tier 1 | Tier 2 | Price 1 | Price 2 |
|---|---|---|---|---|
| ARMOR: max health | 9 (from 8) | 10 | 1500 | 3000 |
| AMMO BAG: ammo capacity | 130 (from 100) | 160 | 800 | 1600 |
| QUICK RELOAD: reload time | ×0.9 | ×0.8 | 1200 | 2400 |

(Q4.) Tiers are bought in order. Tyres stay where they are, a loadout option with a price
(`TIRE_OPTIONS`).

### 4.2 The driver

The driver unlocks at **level 2** (Q5). Below level 2 the player starts on the iron and the driver
key does nothing. The clubhouse's driver card says `UNLOCKS AT LEVEL 2`.

### 4.3 `applyLoadout`

```ts
interface CartKit { tire; maxHealth; maxAmmo; reloadScale; driver: boolean }
kitFor(loadout, upgrades, level): CartKit   // the pure lookup
applyLoadout(cart, kit): void               // the only writer of these stats
```

- `Cart` gains `maxAmmo` and `reloadScale` fields, read where `MAX_AMMO` and `reloadSeconds` are
  today, and `driverLocked`, which `selectClub` honours.
- `SimOptions.kit` replaces `SimOptions.tire`. With no kit, the player gets the default kit:
  street tyres, 8 health, 100 ammo, ×1 reload, driver unlocked. That is today's player, so the
  golden and every existing test are unchanged.
- Bots always get the default kit (Q6).

### 4.4 The golden

Unchanged: the default kit is today's cart, and only `main.ts` passes a kit.

### 4.5 The clubhouse

An UPGRADES column: one row per upgrade with its tier pips, its next effect and a BUY button
priced at the next tier. Upgrades buy at once, outside the preview-and-confirm flow, because there
is nothing to preview (Q7).

## 5. Loadouts for every rig (slice 4)

### 5.1 In the match

- The player's cart wears the equipped paint and skin (`GolfClub.setSlotColors`), over the team
  canopy and shirt.
- **Each bot gets a loadout too**, picked from the cart's index and the course seed by a hash
  (`botLoadout(index, seed)` in `loadout.ts`), so a bot keeps its look through a match and its
  rematch. Render only: bots' stats stay the default kit.

### 5.2 BACKLOG #49: team hues

Team colour lives on the canopy (blue `0x2F7BE0`, orange `0xF07A1A`). Two chassis paints sit too
close to those: `sunset` (`0xEF8A2B`) and `marshal` (`0x2D5FA8`). They are retuned, keeping their
ids and prices so a saved profile still owns them (Q8):

- `sunset` becomes **SUNSET PLUM**, `0x7A3B69`.
- `marshal` becomes **MARSHAL SLATE**, `0x55606B`.

A test asserts that no chassis paint is within a set distance of either team canopy in RGB.

## 6. Smoke checks

One file per slice, each under 15 s, each seen to fail when the code it checks is broken
(`docs/TEST-AND-SPEC-PITFALLS.md`).

- **Slice 1, `src/sim/scoring.test.ts`.**
  - The formulas on fixed inputs, and `addXp` over a double level-up.
  - A real `Sim` (with no course: the flat test arena, so no grid bake): the player's ball kills a
    bot a teammate damaged 2 s earlier. The teammate gets one assist, the player one kill, and
    damage matches the `hit` events in the log. An assist from 6 s back does not count.
- **Slice 3, `src/app/profile.test.ts`.**
  - Round trip; a corrupt blob, an unknown version and a wrongly typed field each fall back.
  - The owned-items bug: buy two paints in two clubhouse visits; both are still owned on the third.
- **Slice 2, `src/sim/upgrades.test.ts`.** `kitFor` on each tier. A cart with the ammo tier holds
  160 balls and not 161; reload ×0.8 fires again sooner; a locked driver ignores `selectClub`.
  The default kit equals a cart built with no kit.
- **Slice 4, in `src/sim/loadout.test.ts`.** `botLoadout` is stable for an index and seed and
  names real options; no chassis paint is near a team canopy.

## 7. Task 0: the suite's time

`npm test` runs about 65 s on a cloud container against the 60 s cap (`docs/HANDOFF.md`). Before
slice 1, trim the slowest file, measured on `main` and on the branch back to back.

## 8. Questions (built to the default)

| # | Question | Default built |
|---|---|---|
| Q1 | What is an assist? | Damage to the victim within the 5 s before a teammate's kill, or before a kill with no killer. One per kill per cart. |
| Q2 | Does a draw pay the win bonus? | No. |
| Q3 | How does a play-tester reach the shop without grinding? | `?coins=N`, added once on load. |
| Q4 | Upgrade numbers | §4.1's table. |
| Q5 | When does the driver unlock? | Level 2: about one good match (750 XP). |
| Q6 | Do bots get upgrades? | No. They keep the default kit, and only their looks vary. |
| Q7 | Upgrades through preview-and-confirm? | No. They buy at once. |
| Q8 | The two team-hued paints: retune or drop? | Retune to plum and slate, same ids and prices. |
| Q9 | Should a profile that existed before Stage 8 (none did: coins were never saved) be migrated? | No. There is nothing to migrate. |
| Q10 | Do loose balls count as pickups? | No. Sites only: buckets, hot dogs and drinks. |

## 9. Slices

Built in this order. The upgrades' sim half came before the profile, because the profile stores
upgrade tiers.

1. **Scoring:** `MatchTally`, the formulas and `scoring.test.ts`. Golden unchanged.
2. **Upgrades in the sim:** `upgrades.ts`, `applyLoadout`, the `Cart` fields, the driver lock and
   `SimOptions.kit`. Golden unchanged.
3. **Profile, shop and results:** `profile.ts`, the clubhouse on the profile with its upgrades
   column, earnings on the results screen, `?coins=N`. Play-test stop.
4. **Every rig's loadout:** paint and skin in the match, bot loadouts, the paint retune. Play-test
   stop.

## 10. Built

- **Task 0.** `tools/simAllocation.test.mjs` bakes the course once for both its describes: 27.4 s
  to 18.1 s alone. The full suite ran 75.0 s on `main` and 69.8 s on the branch in one cloud
  container, still over the cap there (`docs/HANDOFF.md`).
- **After a level-up, PLAY AGAIN starts a new match** rather than resetting the old one, because a
  kit is applied as a `Sim` is built and the level-up may have unlocked the driver.
- **The player starts on the putter**, as before (`Cart`'s default club). The driver lock only
  stops selecting it, so a locked driver changes no starting club.
- **Not seen headless:** a Turrets match still crashes in this container's Chrome (`HANDOFF.md`),
  so the results screen's earnings and the loadouts in the match are for the play-test. The
  clubhouse was checked headless: the upgrades column, the level chip, the driver card's lock and
  a purchase saved to localStorage.
