# Stage 3.5c: the Mulligan Mortar and capture flags

Written 2026-11-27. The spec for the last slice of Stage 3.5 (`docs/REVAMP-PLAN.md`, "3.5c: new
warfare rules"). It settles everything `docs/SPEC-QUEUE.md` item 1 lists as missing. **Nothing is
built until the user answers §8.** Every question there has a default, and the build follows the
defaults wherever the user does not say otherwise.

What is already decided, and not reopened here (`docs/DECISIONS.md`, "Stage 3.5", and its
7 Nov follow-up):

- The mortar is a **killstreak reward at 3 kills**, not a course pickup. It is a telegraphed,
  seeded barrage of 6 balls, and its kills are credited to its owner.
- There are **capture flags A, B and C on three arena greens**. A side holding two or more makes
  the other side **bleed one stroke every 20 s**.
- **Fewest strokes still wins.** The flags add to the existing score; they do not replace it. In a
  3-minute match, kills should still count for more than flags.
- 3.5c **moves the golden once**.

---

## 1. What exists today, and what this touches

Read from the code on `main` at `014c52c`.

- **Scoring.** `Match` (`src/sim/match.ts`) holds per-player `points` (kills) and `strokes`
  (deaths) as `Int32Array(MAX_PLAYERS)`. `teamStrokes(team)` sums `strokes` over a side, and
  `winningTeam()` picks the side with fewer. Deaths reach it through `Match.scoreKill`, called
  only from `Sim.killCart` (`src/sim/world.ts`).
- **Streaks are UI-only.** `StreakTracker` (`src/ui/streaks.ts`) counts the player's kills from
  `kill` events and shows ON THE GREEN at 3. The sim has no per-cart streak, and bots have none at
  all. The mortar needs one in the sim, because bots earn mortars too.
- **Damage is contact-driven.** `processContacts` (`src/sim/combat.ts`) is the only reader of
  Rapier collision events. A pooled ball hurts a cart once, while `flying` and not `spent`, and
  `firedBy` decides who gets the kill. Friendly fire is off (`sameSide`). Spawn protection and
  death both void a hit. There is no splash damage anywhere.
- **The ball pool** (`src/sim/entities/BallPool.ts`) has `POOL_SIZE = 32` bodies.
  `acquire(firedBy, takeOthersInFlight)` reuses idle, then landed, then rolling balls, and only
  the player may take a ball out of someone else's flight.
- **Randomness.** `hashChannel` allocates (rest parameter), so it is construction-time only. The
  per-tick pattern is a `mulberry32` stream built once, as `Sim.spawnRandom` is
  (`hashChannel(seed, SPAWN_CHANNEL)`). Channels in use: `BOT_CHANNEL` 3, `SPAWN_CHANNEL` 4,
  `BOT_SKILL_CHANNEL` 5.
- **Bots** (`src/sim/bot.ts`). `computeBotIntent` runs, in priority order: unstick, then ammo (an
  empty magazine), then heal, then drive at the target's `driveX/driveZ`, which `world.ts` clamps
  inside the zone. A bot fires only within `BOT_ENGAGE_RANGE` (40 m). It chooses a target with
  `pickTarget`.
- **The zone** (`src/sim/arenaZone.ts`) is holes 1, 9, 10, 14, 15 and 18 around the clubhouse.
  Team 0 spawns on the pad 25 m **west** of the clubhouse (`createTeamPads`), and team 1 on the
  pad 25 m **east**.
- **Events** (`src/sim/events.ts`) are a fixed ring written in place. Nothing in the sim reads
  them back, so a new kind cannot move the golden by itself.
- **The golden** (`src/sim/arenaGolden.test.ts`, `4165176536`) plays a scripted 40 s (2,400 tick)
  match on the shipped course with 7 bots. It hashes every cart's position, heading, HP and ammo
  every tick, then `strokesFor(i)` and `pointsFor(i)` per player. It does **not** hash
  `teamStrokes`.

### The six zone greens, measured

Cup positions in the course frame, from `buildCourseWorld(authoredCourse(2026), 2026)`. Each green
is an 11 m circle.

| Hole | Par | Cup (x, z) | From clubhouse | From team 0 pad (W) | From team 1 pad (E) |
|---|---|---|---|---|---|
| 1 | 5 | (307.4, −367.5) | 559 m | 584 m | 535 m |
| 9 | 4 | (−177.7, −363.4) | 130 m | 144 m | **120 m** |
| 10 | 3 | (−404.4, −265.2) | 268 m | 253 m | 284 m |
| 14 | 5 | (−296.5, −352.7) | 136 m | **128 m** | 148 m |
| 15 | 4 | (−255.9, 1.1) | 479 m | 479 m | 480 m |
| 18 | 5 | (−197.0, −354.3) | 131 m | 141 m | 124 m |

Holes 9 and 18 share a corner of the course; their cups are 22 m apart.

---

## 2. Capture flags

### 2.1 Which greens (Q1)

- **A = hole 14** (west, 128 m from team 0's pad).
- **B = hole 10** (the middle flag, 268 m out).
- **C = hole 9** (east, 120 m from team 1's pad).

A and C mirror each other to within 8 m, so each side has a near flag. B is the one to fight over.

B is not perfectly neutral: it is 31 m nearer team 0's pad. Hole 15 is neutral to the metre, but
it is 480 m out, 24 s at the cart's 20 m/s top speed and more over real ground. That is too
far for a 3-minute match. The default takes hole 10 and accepts the 31 m. It is Q1 in case the
user would rather have it fair.

The sites are **derived, not authored**: `arena.ts` gains `captureSites(world)`, which returns the
three cups in course frame from `ZONE_HOLE_INDICES`-style constants
(`CAPTURE_HOLE_INDICES = [13, 9, 8]`). It goes on `ArenaGround` as `captureSites`, empty on a
single-hole arena, as `pickupSites` and `zone` are. The renderer reads the same list, so the two
sides cannot disagree.

### 2.2 State per flag

A new pure module, `src/sim/flags.ts`, written like `match.ts`: DOM-free, Rapier-free, fixed
arrays, no allocation after construction.

```
class CaptureField {
  readonly sites: readonly Vec2[];        // 0..3 of them
  owner: Int8Array;                        // -1 neutral, else the owning team
  progress: Float64Array;                  // -1 .. +1: team 0 toward -1, team 1 toward +1
  contested: Uint8Array;                   // 1 while both sides are inside
  bleedIn: number;                         // seconds to the next bleed stroke
  tick(dt, carts: readonly CaptureCart[], match: Match): void;
  reset(): void;
}
```

`CaptureCart` is the structural slice it reads: `position.x`, `position.z`, `dead`, plus the
index for `teamOf`. `Sim` passes its `carts` getter, which already exists for `pickTarget`.

### 2.3 Capturing, and what "contested" means

Constants, all in `flags.ts`:

| Name | Default | Meaning |
|---|---|---|
| `CAPTURE_RADIUS_M` | 12 | The green's 11 m plus a metre, measured from the cup in x and z only. |
| `CAPTURE_TIME_S` | 6 | One cart alone takes a neutral flag in 6 s, and an enemy one in 12 s (through neutral). |
| `CAPTURE_MAX_CARTS` | 3 | More carts capture faster, up to three. |

Each tick, for each flag, count the **living** carts of each team inside the radius. A dead cart
does not count. A cart under spawn protection does count, since the pads are 120 m or more from
any flag and it changes nothing.

- **Contested:** both teams have at least one cart inside. Progress is frozen. Nobody gains.
- **One team inside:** progress moves toward that team by
  `dt × min(n, CAPTURE_MAX_CARTS) / CAPTURE_TIME_S`.
  - When it crosses 0 coming from the other team's side, the flag goes neutral (`owner = -1`).
  - When it reaches ±1, the flag is that team's (`owner = team`), and the value is clamped there.
- **Empty:** progress stays where it was. There is no decay (Q3).

All three flags start **neutral at 0** (Q2).

"Contested" is per flag and is the plain majority-free rule above. It is not "more enemies than
allies". Outnumbering a defender does not take a flag while they live; killing them does. That
keeps the flag a fight rather than a headcount.

### 2.4 The stroke bleed, and how it joins the score

- **The rule.** While one team owns two or more flags, `bleedIn` counts down from
  `FLAG_BLEED_INTERVAL_S = 20`. Each time it reaches zero, the **other** team takes one stroke and
  the timer restarts at 20. Holding all three bleeds at the same rate as two (Q4).
- **When the holding drops below two, the timer resets to a full 20.** Retaking a second flag
  starts the 20 s again. A partial interval at the buzzer bleeds nothing.
- **The countdown does not bleed.** `CaptureField.tick` runs only on live ticks, after
  `Match.tick`, the same tick `step` would move carts.
- **Where the stroke goes.** `Match` gains `private readonly bleed = new Int32Array(TEAM_COUNT)`,
  `bleedFor(team)` and `addBleed(team)`. **`teamStrokes(team)` becomes the deaths on that side
  plus `bleed[team]`**, so `winningTeam()` and the HUD's `US n — THEM m` pick it up unchanged.
  `strokesFor(i)` stays deaths only.
  - This is a per-team number on purpose. A bleed stroke is not anyone's death, so charging it to
    a player would put it in the MVP's row and in the per-player scoreboard as a death nobody
    died.
  - **The consequence a reader has to know:** the scoreboard's per-player stroke column no longer
    sums to the team total. The results screen (`matchScoreboard.ts`) adds one row per side,
    `FLAGS +n`, so the arithmetic on screen still adds up. Its test must assert the row's sum,
    not only that the row exists (`TEST-AND-SPEC-PITFALLS.md` §1, instance 8).
  - `Match.reset` zeroes `bleed`. `CaptureField.reset` puts every flag back to neutral and
    `bleedIn` back to 20.
- **No points for a capture.** `pointsFor` stays kills, and the MVP stays the top killer. Stage 8's
  economy may pay for captures later; that is its call.

**Is 20 s balanced against kills?** At most 9 bleed strokes fit in 180 s, and only if one side
owns two flags from second 0, which it cannot. A side that takes two flags in the first 40 s and
keeps them bleeds the other side about 7. The 40 s golden match already ends with deaths on both
sides. Slice 1's play-test measures the real numbers over three `?match=180` matches and writes
them in the PR. If flags outscore kills, the interval moves; the rule does not.

### 2.5 Events

Three new `SimEventKind`s, each with its fields stated, because the HUD, the banner and audio all
read them:

| Kind | `actor` | `target` | `amount` | x, y, z |
|---|---|---|---|---|
| `flagCaptured` | `NO_RIG` | flag index 0–2 | the team that now owns it | the cup |
| `flagNeutral` | `NO_RIG` | flag index | the team that lost it | the cup |
| `flagBleed` | `NO_RIG` | the team that bled | that team's bleed total after this stroke | 0, 0, 0 |

Contested is **state, not an event**. The HUD reads `sim.captures.contested[i]` every frame. An
event pair (start/stop) would be two more kinds to keep consistent with state the HUD can read
directly.

---

## 3. The Mulligan Mortar

### 3.1 Earning it

- **The streak is sim state.** `Cart` gains `killStreak` (integer) and `mortars` (0 or 1). In
  `Sim.killCart`, an enemy kill (the same test `Match.scoreKill` uses to award a point) adds one
  to the killer's `killStreak`. The victim's `killStreak` goes to 0. A drowning or zone death
  resets the victim's streak too.
- **The reward.** When a cart's `killStreak` reaches 3, 6, 9 and so on, it gets a mortar, if it
  does not already hold one. It holds **at most one** (Q5).
- **A held mortar survives death** and is lost at the match's end and on `Sim.reset` (Q6).
- A new event, `mortarEarned` (`actor` = the cart), fires on the tick it is earned. The banner
  shows it in place of ON THE GREEN's consequence line: `ON THE GREEN / MORTAR READY [F]`.
  `StreakTracker` stays the thing that writes the headline. The sim event decides the
  consequence, so the two cannot disagree about whether a mortar was earned.

### 3.2 Calling it, and where it lands (Q7)

- **Intent.** `PlayerIntent` gains `callMortar: boolean`, false in `neutralIntent()`. The keyboard
  binds it to **F**. The gamepad binding (**Y / Triangle**) arrives with Stage 4b, and the touch
  button with the touch layer. Nothing reads it during the countdown (`holdIntent` drops it).
- **Where it lands.** On the call tick, the target point is the **landing point of the arc the
  player is aiming**: the equipped club at full charge, along the turret's current yaw, as
  `Sim.previewTrajectory(1, yaw, …)` computes it: the arc H9 draws, at full charge. The player
  aims a mortar with the skill they aim everything else with. `previewTrajectory` reads the
  player's cart, which is fine: bots aim theirs another way (§3.5).
  - It is capped at `MORTAR_MAX_RANGE_M = 160` from the caller. A longer arc lands at the cap
    along the same bearing.
  - A point outside the zone is clamped inside with `zone.clampInside`.
  - `previewTrajectory` writes into a caller's array. `Sim` keeps one private
    `Vec3[]` scratch for the mortar, so the call allocates nothing.
- **A call with no mortar held** does nothing and pushes no event.

### 3.3 The telegraph

- **Delay.** The first ball arrives `MORTAR_TELEGRAPH_S = 2.0` s after the call. The rest follow
  at `MORTAR_BALL_GAP_S = 0.2` s, so the barrage is 1 s long, and 3 s from call to last impact.
- **What every player sees**, render-side from a `mortarCalled` event (`actor` = the caller,
  x, y, z = the target point):
  - a red ground ring of radius `MORTAR_SPREAD_M` at the target point, filling over the 2 s;
  - a rising whistle, positional, from the same point;
  - a marker on the minimap (H8) for the 3 s.
- **What the target sees** in addition: if the player's own cart is inside the ring at the call,
  or drives into it before the last ball, the H12 banner shows `INCOMING! / MOVE`, once.
- **Allies and enemies see the same ring.** The point of a telegraph is that the target can get out
  of it. 2 s at 20 m/s is 40 m, so a cart moving at speed can always escape an 8 m ring, and a
  parked one cannot. That is the goofy-but-fair version (Q8 sets the number).

### 3.4 The barrage

- **Six balls**, through the **existing ball pool**, so every rule that already makes a ball hurt
  (spawn protection, death, friendly fire off, a shield plate absorbing it, the kill credited to
  `firedBy`) applies with no second path.
  - Each is acquired with `ballPool.acquire(owner, true)`, so a barrage never comes up short in a
    full 4v4 pool. A mortar is rare (one per 3-kill streak), so taking six bodies is acceptable.
    If the pool still has nothing (every body is the owner's own, in flight), that ball is
    skipped. There is no refund: the mortar is spent on the call.
  - Each ball spawns `MORTAR_DROP_HEIGHT_M = 40` above its impact point with a straight-down
    velocity of `MORTAR_DROP_SPEED = 20` m/s, and gravity scale 1. It reaches the ground in about
    1.2 s, so it is spawned 1.2 s before its impact time. The exact drop time is computed from the
    two constants, not tuned.
  - `pooled.damage = MORTAR_BALL_DAMAGE = 2`, the driver's.
  - Landed mortar balls are ammo like any other landed ball. A barrage leaves six rounds on the
    grass for whoever survives it.
- **The spread.** Each impact point is the target point plus a uniform offset in a disc of radius
  `MORTAR_SPREAD_M = 8`. The offset is drawn from **one stream per `Sim`**,
  `mortarRandom = mulberry32(hashChannel(seed, MORTAR_CHANNEL))` with `MORTAR_CHANNEL = 6`, built
  in the constructor and rebuilt in `reset`, as `spawnRandom` is. Two draws per ball (radius as
  `sqrt(u)`, angle), drawn on the call tick for all six balls. Bots' own streams are never drawn
  on, so a mortar does not shift any bot's later decisions.
- **Pending barrages** live in a fixed array of `MAX_BARRAGES = 4` slots on `Sim`, each holding
  the owner, the six impact points, the call tick and how many balls have been spawned. A fifth
  simultaneous call is refused and the mortar stays held. 4 is more than a 4v4 can produce: each
  needs a separate 3-kill streak.
- **Splash damage (Q9).** The default is **one point of splash**: on the tick a mortar ball first
  touches down (`touchedDown` goes true in `BallPool.step`), every enemy cart within
  `MORTAR_SPLASH_M = 3` of it, living and unprotected, takes 1 damage credited to the owner. A
  cart the ball hit directly does not also take the splash from it. This is the only splash in the
  game, so it is a new damage path and gets its own test: friendly fire, spawn protection and
  shield plates must each be shown to block it.
  - Without splash, six 2-damage balls in an 8 m disc almost never hit a cart, and the mortar would
    be a light show. With it, a parked cart in the centre takes about 4–6 points.
- `PooledBall` gains `mortar: boolean`, set on acquire and cleared on release, so the splash path
  and the renderer know which balls are mortar rounds.

### 3.5 What a bot does with one

- A bot holding a mortar calls it when its current target is **visible** (`!target.hidden`),
  **alive**, between `BOT_FIRE_RANGE` (35 m) and `MORTAR_MAX_RANGE_M`, and its own team has no cart
  within `MORTAR_SPREAD_M` of the target. Friendly fire is off, so the last condition is about
  looks, not damage. A barrage into a melee reads as a mistake.
- **Its target point is where its target is now**, not where it is going. No lead. A moving target
  escapes the ring, as the player can. That is what makes a bot's mortar fair.
- The decision is a pure function in `bot.ts`, `shouldCallMortar(bot, target, allyNearTarget)`.
  It reads no RNG, so it shifts no stream.

---

## 4. Bots and the flags, without Stage 6

There is no routing yet. Bots drive in straight lines at a point inside the zone, and the existing
stuck/unstick logic gets them off trees and walls. The flags have to work with that.

- **One flag runner per team** (Q10). The runner is each side's lowest-index bot: rig 1 for team 1
  and rig 2 for team 0. Fixed by index, so it is deterministic and needs no RNG.
- **The runner's drive point** is the nearest flag its team does not own, unless an enemy is
  within `BOT_ENGAGE_RANGE`. Then it fights, as every bot does now. When its team owns all three,
  it drives to the owned flag with the most enemies nearest it, which is defending.
- **Every other bot keeps today's behaviour**, with one addition: when its target is farther than
  `BOT_FLAG_DIVERT_M = 120` away, it drives at the nearest flag not owned by its team instead. A
  bot that would otherwise cross the course for a kill picks up a flag on the way.
- **Defending (default off, Q10):** a bot within 80 m of a flag its team owns, while an enemy is
  inside the capture radius, drives to the flag. Off by default because it can strip the fight
  from the middle of the map. Slice 3's play-test decides.
- **Where it plugs in.** `world.ts`'s `botTargetScratch` already writes `driveX/driveZ`.
  The flag logic writes the flag there instead of the target, and `computeBotIntent` is unchanged
  apart from driving to it. Priority order stays: unstick, ammo, heal, then drive. A bot with an
  empty magazine still goes for ammo first.
- **The risk** is straight lines through woods (`TEST-AND-SPEC-PITFALLS.md` §1, instance 12 is the
  failure this guards against). Slice 3's smoke check takes its carts from the course as it
  ships. It first asserts the premise: the runner starts more than 100 m from every flag. Then it
  asserts that the runner is inside a flag's radius within 30 s. Without the premise, the check
  could pass on a course that happened to spawn a bot on a green.

---

## 5. HUD, map and audio, against `docs/UI-SPEC.md`

New and changed rows for UI-SPEC §2, added in the slice that builds each:

| # | Element | Fed by | What |
|---|---|---|---|
| H14 | Team score strip (changed) | `Match.teamStrokes`, `CaptureField` | Already `US n — THEM m`. It gains three flag chips, **A B C**, under it: filled in the owner's team colour (`teamColors.ts`), grey when neutral, with a progress arc for `progress`. A chip pulses while `contested`. When a side bleeds, a small `−1 IN 12s` timer shows under the side that is losing strokes. |
| H18 | Flag on the green (new, render) | `captureSites`, `owner` | A `Flagstick` (`src/entities/Flagstick.ts`, drawn today only on the title backdrop) on each capture green, its cloth in the owner's colour with the flag's letter, and a ring decal at `CAPTURE_RADIUS_M` so the edge is visible. Render-only. |
| H19 | Mortar chip (new) | `Cart.mortars` | Beside the ammo card (H7): `MORTAR [F]` while one is held. Hidden otherwise, not shown empty (UI-SPEC §5's rule about inert elements). |
| H20 | Mortar telegraph (new, render) | `mortarCalled` | The red ring, the whistle, and a minimap marker, as §3.3 describes. |
| H8 | Minimap (changed) | `captureSites`, `owner`, `mortarCalled` | `MapMarker.kind` gains `"flag"`, drawn as its letter in the owner's colour, and `"mortar"` for the 3 s of a barrage. |
| H12 | Event banner (changed) | `flagCaptured`, `flagNeutral`, `flagBleed`, `mortarEarned`, `mortarCalled` | `FLAG A TAKEN / THEY BLEED A STROKE EVERY 20 S` when the player's side reaches two. `WE LOST FLAG B` on a neutral. `INCOMING! / MOVE`. A bleed stroke is **not** a banner (it fires every 20 s): it is the H14 timer and a sound. |

**UI-SPEC §5's CTF (the flag-ball)** is a different mode: a ball carried between bases, from
concept image 07. These capture flags do not build it. The default is that capture flags are the
arena's flags and the flag-ball stays unscheduled (Q11). UI-SPEC gets a line saying so.

**Audio** (`src/audio/audioDirector.ts` maps events to sounds): a capture sting (rising for us,
falling for them), a neutral "thunk", a soft golf-clap tick on each bleed stroke, the mortar
whistle on `mortarCalled` (positional) and an earn chime on the player's `mortarEarned`. The
balls' impacts use the existing impact sounds.

---

## 6. The golden

- **Slices 1 and 2 must not move it.** In slice 1, the flags change only `bleed` and
  `CaptureField` state, and the golden hashes neither. In slice 2, the scripted player never calls
  a mortar (`neutralIntent()` gives `callMortar: false`), and bots do not call one until slice 3.
  A bot can earn one in the 40 s, but earning moves nothing. If `arenaGolden.test.ts` moves in
  either slice, something reached the sim that should not have. Stop and find it.
- **Slice 3 moves it, once,** in the commit that turns on bot flag running and bot mortar calls.
  That commit re-records `4165176536`, and its message says why: bots now drive at flags and call
  mortars. **It is recorded from Linux x64** (a cloud session or CI), never from an Apple Silicon
  Mac (`DECISIONS.md`, "The golden fingerprint is Linux x64's"). Run
  `npx vitest run src/sim/arenaGolden.test.ts tools/simAllocation.test.mjs` before and after.
  The allocation check proves the flags and barrages allocate nothing per tick.
- `Match.teamStrokes` is not hashed, so the slice 3 commit should also add
  `match.teamStrokes(0)` and `(1)` to the fingerprint, in the same re-record. Otherwise a bleed
  regression could never move it.

---

## 7. Slices

Three slices, each ending at a play-test stop, as the Caswell plan does. Each one's smoke check
runs in 15 s or less. **Root `npm test` was 57.7 s on #98, against the 60 s cap.** Each slice
trims the slowest test file before adding its own check (`AGENTS.md`, 1 Oct rule), and says what
it trimmed in the PR.

### Slice 1: the flags (sim, HUD, map, audio)

- `src/sim/flags.ts` (`CaptureField`), `Match.bleed` and `teamStrokes`, `captureSites` on
  `ArenaGround`, the three events, H14's chips, H18, H8's flag markers, the results screen's
  `FLAGS +n` row, and the sounds.
- **Smoke check:** `src/sim/flags.test.ts`, pure (no Rapier), under 1 s. It must be able to fail
  for each of these:
  - capture takes 6 s with one cart and 2 s with three, exact to a tick;
  - a contested flag does not move;
  - an enemy flag goes neutral before it changes hands;
  - the bleed lands at exactly 20 s of holding two, and the timer resets when the holding drops
    to one;
  - `teamStrokes` equals deaths plus bleed, and `winningTeam` reads it.

  Plus one case on the shipped course's `captureSites`, which asserts each site is inside the zone
  and on a green (`surfaceAt` is `Green`). Seen red with the indices off by one.
- **Golden unchanged.**
- **Play-test** (`?match=60`, then one `?match=180` for the numbers): you can see which flags are
  whose; taking one feels like the right length; the bleed reads as a consequence and not as
  noise; and the stroke totals from three full matches go in the PR.

### Slice 2: the mortar, for the player

- `Cart.killStreak` and `mortars`, `mortarEarned`, `PlayerIntent.callMortar` and the F key, the
  target point, the barrage slots, `mortarRandom`, splash damage, `PooledBall.mortar`, H19, H20,
  the banner and the sounds. Bots earn mortars but never call them.
- **Smoke check:** `src/sim/mortar.test.ts`, on a single-hole arena `Sim`, under 10 s. It must be
  able to fail for each of these:
  - the mortar is earned on the 3rd kill, not the 2nd, and a death in between resets the count;
  - six balls land within `MORTAR_SPREAD_M` of the target, the first at 2.0 s;
  - the same seed gives the same six points;
  - a kill by a mortar ball is credited to the caller;
  - splash is blocked by friendly fire, by spawn protection and by a shield plate.
- **Golden unchanged.**
- **Play-test:** earning one is noticed; the ring gives enough warning to escape at speed and not
  enough when parked; the barrage looks goofy; it kills a parked cart.

### Slice 3: bots (flag runners, defending if the user wants it, mortar calls), and the golden

- The runner rule, the divert rule, `shouldCallMortar`, and the golden re-record with
  `teamStrokes` added to it.
- **Smoke check:** one case in `src/sim/world.course.test.ts` on the shipped course, with the
  premise assertion from §4. Under 15 s. If that file is the slowest, trim it first.
- **Golden re-recorded once, from Linux x64.**
- **Play-test:** bots take flags without being told to; they don't get stuck on the way to B; a
  bot's mortar is escapable; and a match still feels like a fight, not a relay race.

---

## 8. Questions for the user

Each has a default. The build starts from the defaults the moment you answer, and an unanswered
question takes its default.

| # | Question | Default |
|---|---|---|
| Q1 | Which three greens? | **A = hole 14, B = hole 10, C = hole 9.** B is 31 m nearer your pad. The fair alternative is B = hole 15, which is neutral but 480 m out. |
| Q2 | Do flags start neutral, or does each side start owning its near flag? | **All neutral.** Owning A and C from the start would mean nobody holds two at the whistle, so the opening is a race for B either way. Neutral adds a second race for the near flags. |
| Q3 | Does an empty flag's progress decay back? | **No decay.** Half a capture stays half a capture. |
| Q4 | Does holding all three bleed faster? | **No.** 1 stroke every 20 s for two or three. |
| Q5 | How many mortars can a cart hold, and is one earned every 3 kills in a streak? | **One at a time, earned at 3, 6, 9…** in a streak. |
| Q6 | Is a held mortar kept after you die? | **Kept.** The streak resets; the reward does not. |
| Q7 | How does the player aim it? | **Where your full-charge arc lands**, capped at 160 m. Alternatives: the enemy nearest the crosshair, or a point picked on the map. |
| Q8 | Telegraph length and ring size? | **2 s and an 8 m ring.** |
| Q9 | Splash damage? | **1 point within 3 m** of each ball's touchdown. Without it, the mortar rarely hits anything. |
| Q10 | Bot flag behaviour? | **One runner per side, plus a divert for bots with a far target. Defending off.** |
| Q11 | Do capture flags replace the flag-ball "CTF" mode in UI-SPEC? | **Yes, for now.** The flag-ball stays unscheduled. |
| Q12 | Should a capture earn points (for the MVP, and later Stage 8 coins)? | **No.** Points stay kills. |

---

## 9. Not in this spec

- Routing (Stage 6). §4 is what bots do until it exists.
- Gamepad and touch bindings for `callMortar` (Stage 4b and the touch layer). The intent field is
  ready for them.
- Any change to how kills, rams or the zone drain score.
- The flag-ball CTF mode.
