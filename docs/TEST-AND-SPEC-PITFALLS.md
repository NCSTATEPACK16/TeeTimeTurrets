# Pitfalls: how tests and specs have lied on this repo

Every entry below is a real defect that shipped into a commit or a plan on this
repository and was caught later, usually by a reviewer instrumenting something rather
than reasoning about it. None of them were caught by the test suite, because in most
cases the test suite was the thing that was wrong.

Read this before writing a spec, a plan, or a test. `AGENTS.md` holds the invariants;
this file holds the ways we have violated them while believing we had not.

---

## 1. The recurring one: a test that passes for a reason unrelated to its name

Nine instances in the table, and the turret session added four more that are described in that
spec's own header rather than here. This is the defect class this repo produces, and it produces it
faster than review catches it. In each case the suite was green, the name described the
right behavior, and the assertion was measuring something else entirely.

| # | Test | What it claimed | What it actually measured |
|---|---|---|---|
| 1 | `equips the club the player selects` | Two clubs drive to different distances | `sim.current.position` — the **course** ball, which only moves in stationary mode. Both club distances had collapsed to ~0.0002 m. The test compared two numbers that were both about to be permanently zero. |
| 2 | bot RNG re-seed on `reset()` | `reset()` re-seeds each bot's stream | Its 200-tick burn-in drew from `rig.random` **zero times** — the bot's first charge release doesn't happen until ~tick 400. The test caught a wrong-seed re-seed but would have passed with the re-seed deleted entirely. |
| 3 | `freezes the world once the match is over` | The world stops when the clock hits zero | `sim.cart.position`, the live entity, which the `matchOver` early return freezes trivially. The *rendered* world kept jittering at 60 Hz forever, because `previousCart`/`currentCart` were left one tick apart and `GameLoop` keeps sweeping alpha. It passed while the bug it was named for was fully present. |
| 4 | `keeps the score a cart died on` | A cart's score survives its death | The tick that killed the bot was the same tick that ended the match, and that tick returns before touching any cart. **No death was ever processed.** It would have passed if the respawn path zeroed `strokesTaken` — precisely what it existed to rule out. |
| 5 | smoke: `results overlay names an outcome` | The overlay writes a headline | `index.html` shipped `<h1 id="results-headline">DRAW</h1>`. `headline.length > 0` is true from **static markup, before any JS runs**. It would pass with the entire feature deleted. |
| 6 | smoke: `results overlay is hidden while the match runs` | The overlay starts hidden | `#match-results` carries `hidden` in markup. True at boot with the feature absent. |
| 7 | `refuses an empty instance list` | `mergeGraphInstances([])` throws a deliberate error | `expect(...).toThrow(/instance/i)` — satisfied by `TypeError: mergeGraphInstances is not a function`. It went **green against a function that had not been written yet**, in the same run that showed its six siblings red. The word it matched was in the name of the missing function. Fixed by matching the message tightly (`/at least one instance/`). |
| 8 | `blends two holes together rather than stacking them` | Overlapping ground averages instead of summing | `blended` between `min(own)` and `max(own)` — which a **sum** also satisfies whenever one height is negative and the other positive, which is most points on a field whose noise is centred on zero. It passed against `return sumHeight`. Fixed by asserting the mean exactly: both influences are 1, so the answer is arithmetic, not a range. |
| 9 | `hangs a skirt on every tile` | Each ground tile drops an apron below its rim | `box.min.y <= lowestSurfaceVertex` — satisfied by **equality**, so a tile with no skirt at all passed. Fixed by counting the vertices that hang exactly `SKIRT_M` below the ground at their own (x, z) and requiring at least one. |

**8 and 9 were found by mutating the finished module, not by a red run** — both were written after
the code they cover, which is the case the red-first rule cannot reach. A comparison operator
chosen one notch looser than the claim (`toBeLessThanOrEqual` for "hangs below", a range for "is
the average") is the same failure as instance 7's loose regex: an assertion wide enough to admit
the bug it was named for. Ask of every assertion what else would satisfy it.

Number 7 is the cheapest one here to reproduce and the most useful to have seen. It cost nothing —
the test was red-first, as the rule says, and it was still wrong; what caught it was **reading** the
red line rather than counting the red lines. A loose `toThrow` regex is the easiest way in this
codebase to write an assertion that can never fail: every `TypeError` a missing symbol produces
carries that symbol's own name.

### What actually prevents this

**See every test red before the code that makes it green, and keep the output.** This is
the single highest-yield rule on this repo. It is cheap, and it has caught more than
review has.

**For a test that guards against rot rather than driving new code, break the guarded
thing deliberately and watch it fail.** A test you have never seen fail is a claim, not
evidence. Instances 2, 3 and 5 were all written as rot guards and all three were inert.

**Make the red discriminable, not merely red.** Instance 2's second attempt had to prove
*two* distinct failure modes (wrong seed, and missing seed) produce *different* wrong
values — otherwise one red is indistinguishable from the other and the test only pins one
of them. "It failed before and passes now" is satisfied by a test that fails for a third,
unrelated reason.

**Assert on the layer the consumer actually reads.** Instance 3 asserted on sim state when
the renderer reads the interpolation pair; instance 1 asserted on the course ball when the
game fires pooled balls. Before writing the assertion, ask: *who reads this value in
production?* Assert on that.

**Static markup is not a test fixture.** Instances 5 and 6 are the strongest form of this
defect because they survive deleting the feature. If a browser check asserts on DOM text
or an attribute, the markup must ship *empty* or in the opposite state, so that only the
code under test can satisfy the assertion.

**Run the guard-rot experiment, and be careful diagnosing it.** The Task 8 implementer did
exactly the right thing — commented out `drawMatchResults`, re-ran smoke, saw it still
PASS — and then attributed it to stale `dist` output instead of to the literal `DRAW` in
the markup. The experiment found the bug; the diagnosis threw it away. When a guard-rot
run passes, the default assumption is that the check is inert, not that the build is stale.

---

## 2. Plans that carry complete code propagate their own bugs verbatim

Several tasks on the cart-combat plan shipped the full implementation and the full test
bodies in the plan text. That makes the implementer fast and the diff predictable, and it
means **a defect in the plan lands in the code and in the test that would have caught it,
in the same commit, with nobody questioning either.** Instances 4, 5 and 6 above were all
brief-verbatim. So was a duplicated best-bot loop that created a second source of truth
under a doc comment asserting "one rule, stated once, so the headline and the numbers
under it cannot disagree" — the rule was stated twice, in two files, and they could
disagree.

Implementers do not push back on brief-verbatim text, because being verbatim is what they
were asked for. Reviewers do — but only if the review prompt tells them plan authorship
is not a defense. The review rubric that works says: *if the plan mandates something this
rubric calls a defect, that IS a finding, reported as Important and labeled plan-mandated.*

For future plans: prefer specifying the **behavior, the exact values, and the failure the
test must be able to detect** over pasting a test body. A pasted assertion is copied; a
described failure mode has to be understood.

---

## 3. Assumptions about third-party behavior, taken from docs instead of a probe

A reviewer found that `setTranslation` does not clear a pending
`setNextKinematicTranslation`, reasoning from the `rapier3d-compat` `.d.ts` docstring. The
implementer tested the actual binding — with a control case proving the queue mechanism
works when nothing overrides it — and found the opposite: `setTranslation(p, true)` *does*
override the pending next-kinematic position in this build. The proposed two-line "fix"
was a no-op, and the comment it would have carried would have asserted something false.

`AGENTS.md` already carries a "Rapier JS binding caveats — verified against issues, not
assumed from the Rust docs" section. It exists because of exactly this, and a reviewer
walked into it anyway.

**A lying comment is worse than no code.** When a fix's only artifact is a comment
explaining a behavior nobody has observed, that is the signal to probe instead of commit.

---

## 4. Specs that describe intent without naming what makes it true

- **"`Sim.ball` becomes a dormant reference."** It stayed a registered `"ball"` actor in
  `CombatRegistry`, so driving over your own tee damaged your own cart — invisible at the
  old fixed 100 HP, lethal against a par-3 cart's 6 HP, and once every ball contact cost a
  stroke, a source of phantom strokes that the match's win condition then read as the
  score. A dormant ball that damages carts is not dormant. The spec said the *what*; only
  the registry call said the *whether*.
- **`Stats` ownership was never answered.** Pooled balls carry no owner, so `combat.ts`
  credits any ball's hit to the player. Latent only because `accuracy()` has no non-test
  caller. It has been deferred twice because the question "is `Stats` per-cart or
  player-only?" is a spec question that no task was allowed to settle.

**When a spec says a thing becomes inert, name the registration, listener or table it must
leave.** When it introduces a per-entity concept, say whose it is.

---

## 5. Browser-visible behavior the headless suite structurally cannot see

The results overlay's PLAY AGAIN button is unreachable for any player who aimed with the
mouse: the canvas holds pointer lock, so the cursor is captured and the button cannot be
clicked until the player guesses to press Esc. All 26 smoke checks passed — because the
smoke driver uses keyboard `hold()` calls and never clicks the canvas, so it never enters
pointer lock, and `page.click` dispatches at coordinates regardless of lock state.

Same task, same file: `#hud` and `#match-results` are both `position: fixed` at
`z-index: auto`, and the overlay comes *first* in the DOM — so the HUD paints on top of the
modal that is supposed to cover it. Nothing in a DOM-free unit test can see paint order.

**Rules that fall out of this:**
- A modal added to the playable path must release pointer lock, and the review must ask
  about it explicitly, because no test will.
- Two `position: fixed` siblings at `z-index: auto` stack in DOM order. If a thing is meant
  to cover another thing, give it an explicit `z-index` and say so.
- When a check passes but the driver never enters the state a real player is in, record in
  the report what the harness **can** and **cannot** verify, rather than reporting a pass.

---

## 6. A defect that exists only in the bundle, and in nothing the suite runs

The built game rendered a plain blue rectangle — sky, and not one vertex of anything else —
while `tsc` was clean, 446 tests passed, and the scene gate passed 5/5 with a mean signature
delta of 0.00.

`src/sim/placement.ts` computed a module-level constant from `WOODS_WEIGHT`, exported by
`src/sim/surfaces.ts`, and the import graph was a cycle:
`course -> placement -> surfaces -> course`. Rollup emitted `surfaces.ts`'s initialiser
**after** `placement.ts`'s module body, and the minifier had rewritten the `const` as a
hoisted `var`, so the read returned `undefined` rather than throwing a TDZ error.
`inverseSmoothstep01(undefined)` is NaN, so every bunker on all eighteen holes got NaN
coordinates, `ellipseFalloff` NaN'd `heightAt`, and all 48,841 ground vertices came out NaN.
The sim kept running, the HUD kept counting, and the renderer kept clearing to the sky colour
with nothing drawable in front of it.

**No test could see it, and this was not an oversight in any of them:**

- **`vitest` cannot reproduce it at all.** An unbundled ESM graph evaluates a cycle in the
  order the language specifies, so the constant is always initialised in time. The suite is
  not running the artifact that has the bug.
- **The scene gate loads harness rigs, never a course.** Its five subjects are a cart, a ball
  and a target on a fixed rig. It has no opinion about terrain and never builds one.
- **`npm run smoke` *would* have caught it — and is not part of `npm run build`.** Worse, the
  one check that would have reported it, `cart does not fall through the world`, crashed the
  whole run with a `TypeError` instead: `page.evaluate` serialises NaN as `null`, and the
  detail string called `.toFixed` on it. The assertion that mattered never printed a FAIL.

### What actually prevents this

**A constant shared across an import cycle is a shipping hazard, not a style complaint.**
Whether it bites depends on emission order, which is the bundler's choice and not yours.
`tools/importCycles.test.mjs` now fails `npm test` on any value-import cycle in `src/**` —
verified red against the tree that shipped this bug, where it names the exact cycle.

**Home a shared constant in a module strictly upstream of every consumer, with no path back.**
That is why `WOODS_WEIGHT` now lives in `terrain.ts` and the two driver distances in
`carry.ts`. Do **not** fix a failure of this kind by making the derived value lazy: that
silences the symptom at one call site and leaves the ordering hazard in place for the next
constant somebody adds.

**A check that crashes is worse than a check that fails.** `check(...)`'s own detail string
is code, runs before the comparison is recorded, and takes the process down with it. Format
defensively in any detail argument that can receive a value from the page.

**Ask what the passing gate actually loads.** "Build + gate green" read as "the game works".
The gate had never rendered a course in its life. When a gate's subjects are fixtures, its
pass says nothing about the artifact a player downloads.

---

## 7. Reports that grade their own work

Two of the entries above were found by re-reviewers who instrumented a scenario instead of
reading the report's rationale — and in one case disproved the fix report's own stated
reasoning while the fix itself was fine. The report claimed a burn-in left the RNG stream
"genuinely advanced"; it drew from it zero times.

**Treat an implementer's report as unverified claims, including its design rationales.**
"Left it per YAGNI" and "kept it simple deliberately" are the implementer grading their own
work; a stated rationale never downgrades a finding's severity. When a report is corrected,
correct it *in place with a visible correction block that leaves the original beneath it* —
a silently edited report teaches the next reader nothing, and the false rationale is the
part that outlives the session.

---

## 8. Small things that were deferred and should not be forgotten

Kept here because each one is a real behavior, not a cleanup, and each was deferred with a
reason rather than fixed:

- **A bot cannot abort a charge.** When its aim drifts outside tolerance mid-charge, the
  intent stops asserting fire, but `Cart`'s release-edge weapon model discharges the
  accumulated charge anyway — costing ammo and skipping `applyAimSpread`, because the shot
  never passes through the branch that applies it. The bot's decision *not* to shoot is
  expressed as the action that shoots. The player labours under the same release-fires
  rule, so this is design, not asymmetry — but it is design nobody chose.
- **`reset()` reproduces the RNG stream, not a bit-identical physics replay.** The Rapier
  world carries step-count history. The code matches its stated promise; anyone building
  replay or spectator features will expect more than it gives.
- **The tick that ends the match is discarded.** An N-tick match simulates N-1 ticks, so an
  event that would resolve on the buzzer tick (a ball in flight landing a hit) never
  resolves. Negligible at 180 s; do not restate "the closing tick's score is the one that
  counts" in a doc, because it isn't quite true.
