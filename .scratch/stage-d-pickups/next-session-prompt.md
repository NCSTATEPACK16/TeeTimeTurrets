Settle Stage D (pickups) on this repo (NCSTATEPACK16/TeeTimeTurrets), then spec it, then cut issues.

**Do not implement anything this session.** `.scratch/stage-d-pickups/prd.md` is a pre-grilling
stub: it states the feature, inventories what the codebase actually provides, and lists eleven
decisions that are explicitly not its author's to settle. An agent that starts writing
`Pickup.ts` is inventing those eleven answers and burying them in code where nobody will find
them. The output of this session is a design document and a set of issues, the same way #22–#24
were produced.

## Run it in this order

1. **`mattpocock-skills:grilling`** — grill me on the open decisions below. Hard. Most of them
   have a cheap answer and a right answer and they are not the same one.
2. **`write-a-prd`** — turn what I settled into
   `docs/superpowers/specs/2026-09-<dd>-stage-d-pickups-design.md`, in the voice of
   `docs/superpowers/specs/2026-09-12-hole-ownership-near-the-apron-design.md`: Problem Statement,
   Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope. Record what
   was **rejected and why** — that section is what stopped #22–#24 being relitigated by every
   subagent that touched them.
3. **`superpowers:writing-plans`** — a task-by-task implementation plan with real line references
   and stop conditions.
4. **`to-issues`** — one issue per task, with acceptance criteria and stated blockers.

## Read before grilling me

- `.scratch/stage-d-pickups/prd.md` — the stub. Its "What the codebase already provides" and
  "Load-bearing facts" sections were verified against the code; trust them, but re-check any line
  reference you are about to build on, because the ownership work has since moved that file.
- `AGENTS.md` — house rules. `docs/TEST-AND-SPEC-PITFALLS.md` — this repo's named recurring
  defects; §1 and §2 bear directly on how you write the plan.
- `docs/DECISIONS.md`, "Assembling the course: influence, not a mosaic" **and** "Hole ownership
  near the apron: a defined tie-break, not a blend fix" — placement asks the code both entries
  describe.
- `docs/ROADMAP.md:436-439` and concept sheet `06` — the stated feature.
- `../Claude-of-Tanks-main/src/game/consumables.ts` (42 lines, MIT) — the roadmap says port it for
  the cooldown model rather than writing one. **Any port needs a root `NOTICE` entry in the same
  change** (`AGENTS.md` §License note). Confirm it actually fits before committing to it; a
  42-line port that needs 30 lines of adaptation is not a port.

Use jCodemunch MCP tools for code navigation per CLAUDE.md — `resolve_repo` first (this repo
indexes as its own root, not as part of the parent folder). Use `Read` only on a file you are
about to edit.

## What changed since the stub was written — read this before trusting decision 8

**Ownership is fixed.** PR #25 (issues #22, #23, #24) landed the tie-break: where corridor
influence saturates, the owner is the hole the point is most centred in. All eighteen cups report
`green`. The stub's load-bearing fact 8 and its decision 9 are **closed** — placement can ask
`weightsInto` which hole owns a point and get a trustworthy answer, and that was the entire reason
Stage D was sequenced second.

**But it came with a consequence that is new input to this design.** `lastCentredness` measures
distance to the *spline* even when a water polygon or bunker ellipse is what saturated the
influence, so a point deep inside a pond can lose a tie to a better-centred neighbouring corridor.
Measured: **8,824 m², 22% of the course's reported water, now reports dry.** `surfaceAt` returns
`fairway` for ground carved below a pond's water line, and `checkCartWater` gates drowning on that
same call. This was accepted deliberately and recorded in `docs/DECISIONS.md`; a hazard-aware
tie-break was not rejected on its merits and remains open.

That matters here because the stub's load-bearing fact 4 says no "drivable" predicate exists and
the nearest thing is a scatter filter on `weights.sand === 1 || weights.water === 1`. **A pickup
placed on that predicate can spawn in a pond.** So Stage D has to decide whether "valid anywhere
drivable" trusts the material lookup, asks the hole's own `Surfaces` directly, or is the reason to
go fix the hazard tie-break first. That is a real fork and I want it grilled, not assumed.

## Before grilling: five questions for a research pass

Hand these to a research model first. They are the parts of Stage D that prior art can settle
faster than I can argue them, and I would rather be grilled against evidence than against vibes.
The rest of the stub's open decisions are repo-specific and are not research questions.

**The research is already done. Review it before anything else.**

- `.scratch/stage-d-pickups/research-brief.md` — what was asked (five questions plus ten
  golf-native power-ups). Standalone; the research model had no code access.
- `.scratch/stage-d-pickups/research-answers.md` — what came back. **Not yet reviewed by me.**

Read the answers critically. It is a strong document, but it is a research model's opinion with
uneven sourcing, and the grilling starts from it rather than accepting it. Eight things I noticed
on a first pass and want your view on:

1. **Citation quality is uneven.** Quake 3's 35 s/25 s and UT99's 27.5 s/60 s item timers are
   cited to Reddit threads and a Scribd upload, not primary sources. The numbers are probably
   right; verify before any of them reach a spec.
2. **Its answer to Q1 — per-cart cooldowns — reverses today's model** (one global 60 s timer). It
   argues well that global timers read as starvation at six players over 36 ha. But per-cart
   cooldown means a pickup is *present for one cart and absent for another*, so the rendered world
   differs per viewer, and in a future multiplayer server that becomes per-client state. The
   answer never addresses that. Grill it.
3. **Its answer to Q3 recommends two things that fight each other**: seed a baseline with
   variable-radii Poisson-disk (deterministic, fine), *and* dynamically inject pickups ahead of
   players just out of sight, L4D-style. The second is visibility-dependent runtime state, which
   is in direct tension with the deterministic replay it endorses in Q5. It does not reconcile
   them. This is the weakest part of the document.
4. **Its answer to Q4 — poll, don't use sensors — is the strongest section**, matches what the
   repo already does, and names the exact failure a sensor queue would hand us (two carts crossing
   on the same tick, resolved by engine-internal ordering). I would take this one.
5. **Its answer to Q5 (bifurcated map seed + match nonce in the replay header) cleanly answers
   open decision 9.** But it says the nonce is "generated by the server (or host client)" — there
   is no server; this is single-player with bots today. Decide who generates it.
6. **It asserts Rapier's `enhanced-determinism` flag "must be active" to force libm math.** That
   is a Rust crate feature. Whether the JS/WASM binding exposes it at all is unverified, and
   `AGENTS.md` has a standing rule about Rapier binding behaviour taken from Rust docs rather than
   probed. Do not put this in a spec until someone has checked it against the installed build.
7. **Two of the ten power-ups are far larger than they look.** "Casual Water" (#6) needs dynamic
   localized friction overrides on terrain, and "Ground Under Repair" (#9) spawns kinematic
   colliders at runtime. Both touch the terrain and collider systems; price them honestly before
   they go in a first slice.
8. **"Sugar Rush" (#2) is the best single idea in the document** — decaying temporary HP whose
   state is read off a dimming particle effect rather than a HUD bar. It answers open decision 2
   without adding the HUD element we do not have.

**What the research could not know:** the hazard consequence from PR #25. 22% of the course's
reported water now reads as dry ground, and `surfaceAt` is what a placement validity check would
ask. None of the ten power-ups, and none of the scatter discussion, accounts for pickups spawning
in a pond that reports fairway. That is still ours to settle.

Treat the ten power-ups as a menu to argue with, not a shopping list. The stub's concept art names
three (bucket = ammo, drink = shield, hot dog = health); the research keeps all three but replaces
the shield's mechanics outright.

## The decisions I need you to grill me on

All eleven are in the stub. These are the ones where I expect the cheap answer to be wrong:

- **What is a shield?** `Cart.protectedFor` is respawn invulnerability — its own doc comments say
  protection is a property of respawning, and it is forfeited by firing. Reusing it for a pickup
  means a shield you lose by shooting. One of the three pickup types has nothing behind it.
- **Consumed for the match, or respawning on a cooldown in place?** Today's model is a 60 s
  in-place respawn with a *global* cooldown, so a bot can deny the player. Grill whether that is
  design or accident.
- **"Re-rolled per match" is ambiguous** between seeded-from-the-course-seed (replay-identical) and
  a per-match nonce (genuinely novel, replay-divergent). The existing `Sim.reset` precedent is
  replay-identical. Make me say which, and make me say what `reset()` means for replay if I pick
  the nonce.
- **Sensor colliders or the distance poll?** The roadmap says sensors; the repo has zero. Adopting
  them makes this the first. Ask what that buys over an O(carts × pickups) poll at this scale.
- **Is the food cart collider-bearing?** If yes it is procedural TS on the `Flagstick` route, and
  `.glb` is off the table — `tools/decorBoundary.test.mjs` enforces that.
- **Do pickups exist in STROKE mode at all**, or are they suppressed alongside ammo and damage?
- **One gold map dot or three colours?** `MapMarker.kind` is a closed union with one colour per
  kind; three types means changing it.

## Hard constraints on whatever you spec

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment.
- **Never `Math.random()` in `src/sim/**`.** Placement is seeded — `mulberry32` / `hashChannel`,
  and a `PICKUP_CHANNEL` would be new. Channels are declared per module, not centrally; check for
  collisions with `BOT_CHANNEL = 3`, `SPAWN_CHANNEL = 4`, Trees' 3, and `course.ts`'s 4/2/1.
- **No allocation in query paths.** If placement or the per-tick check touches `weightsInto`, it
  uses caller-owned scratch — the existing pattern.
- **`weightsInto` returns -1 for open rough.** Any placement rule has to say what that means.
- **Every `THREE.Mesh` disposes its geometry and material**, and every Rapier body or collider
  created outside `Sim.create()` needs a removal path. Pickups are the first thing in this repo
  that spawns and despawns course-wide; say who owns teardown.
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  behaviour; `npm run gate` and `npm run smoke` settle presentation. Do not let a plan claim a gate
  pass proves placement is right.
- **Specify the failure each test must be able to detect**, not the test body.
  `docs/TEST-AND-SPEC-PITFALLS.md` §2: plans that carry complete code propagate their own bugs
  verbatim into both the code and the test that would have caught it. §1 is worse — six tests on
  this repo were green while the bug they were named for was fully present. For every assertion
  you specify, say what else would satisfy it.

## Done when

There is a design document, an implementation plan, and a set of issues on GitHub — each issue
scoped, spec-backed, with acceptance criteria and its blockers named. No code.

Tell me plainly if grilling surfaces something that makes Stage D the wrong next thing to build.
