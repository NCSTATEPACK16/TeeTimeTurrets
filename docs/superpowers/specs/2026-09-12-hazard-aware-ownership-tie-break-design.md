# A hazard-aware ownership tie-break

Written 2026-09-12. The sequel to
`docs/superpowers/specs/2026-09-12-hole-ownership-near-the-apron-design.md`, and the thing that
document's own closing note left open: *"A hazard-aware tie-break — one that hands a tied point to
whichever hole's own placed hazard it falls inside — is the obvious alternative and remains open to
whoever wants to build and test it; it was not rejected on its merits."*

Settled by grilling recorded in `.scratch/stage-d-pickups/` alongside the Stage D decisions. This
change is a **blocker for Stage D**, not part of it, and lands as its own commit.

---

## Problem Statement

Ownership near the clubhouse apron is decided by a tie-break: where two holes' influence both
saturate at one, the point goes to the hole it is most centred in, measured as distance to that
hole's spline divided by the corridor half-width there.

Influence does not only saturate from a corridor. A hole's placed water polygons and bunker
ellipses raise it too, and deliberately so — a pond that is only half-carved is a pond a cart drives
into and does not sink in. But centredness is written once, near the top of the influence function,
always as distance to the spline, before either hazard loop runs. So when a hazard is what claimed
the point, the tie is decided on a quantity with no bearing on why the hole claimed it: the pond
hole's *corridor* centredness is compared against a neighbour's, and a point deep inside a pond can
lose to a better-centred corridor forty metres away.

*Measured, real code both ways, seed 2026, on the 2 m physics grid over the full course bounds:*
the course reported 9,993 cells of water before the tie-break landed and 7,787 after. The
difference is 2,206 cells — **8,824 m², 22% of the course's reported water, now reads dry.**

The consequence is not cosmetic. The hazard channel is read from the owning hole alone, so the
renderer paints that ground dry. Cart drowning is gated on the same surface lookup, so a cart
crossing those 8,824 m² neither drowns, nor pays the stroke, nor is returned to dry land — and
arena drives this course for up to three minutes a match.

This was found in review, measured, put to the repository owner, and accepted deliberately rather
than fixed. It is reopened now because Stage D specifies pickup placement to ask that same surface
lookup whether a candidate point is valid ground. A pickup that spawns in a pond reporting fairway
is the same defect with a second consumer, and building placement on it would be the exact mistake
the ownership work was sequenced ahead of Stage D to avoid.

## Solution

A point inside a hole's own placed hazard is maximally inside that hole's claim. Nothing is more
"this hole's ground" than the middle of its pond.

So centredness becomes hazard-aware: where a water polygon or a bunker ellipse is what raises the
weight, and the point falls inside that shape, centredness is zero — the value that already means
"dead centre" — and the point wins any tie against a hole claiming it only through a corridor.

The rule stays one sentence and stays general: **a tied point goes to the hole whose own placed
geometry it is most inside, hazard or corridor.** That is the same sentence its predecessor
established, with the word "corridor" no longer smuggled into it by the implementation.

The change is confined to the discrete ownership channel, exactly as its predecessor was. The
continuous weight vector, the cubing and the normalisation above one are untouched, so assembled
heights cannot move and the grade invariant does not need re-deriving.

## User Stories

1. As a player driving into a pond in arena, I want my cart to drown, so that the hazard I can see
   is the hazard the game plays.
2. As a player, I want water drawn where water is, so that the ground I am reading matches the
   ground I am driving on.
3. As a player putting near the apron, I want a hazard to hold its ground against a neighbouring
   corridor, so that a pond is not silently smaller than it is drawn.
4. As a developer placing pickups course-wide, I want the surface lookup to be trustworthy inside
   hazards, so that placement validity is a real answer rather than a known-wrong one.
5. As a developer, I want the tie-break rule to be statable in one sentence that matches what the
   code does, so that reading the comparison does not contradict reading the decision record.
6. As a developer, I want the fix to cover bunkers as well as water, so that the rule is "hazards"
   rather than "hazards, except the ones we did not get to".
7. As a developer, I want the change confined to the discrete channel, so that I can be certain
   assembled geometry has not moved.
8. As a reviewer, I want the restored water measured as an area, so that "it works" is a number and
   not an impression.
9. As a reviewer, I want the eighteen-cup assertion confirmed still green, so that fixing hazards
   cannot quietly break the thing the previous fix bought.
10. As a maintainer, I want the decision record updated rather than appended to, so that the entry
    that currently describes this as accepted does not outlive its acceptance.

## Implementation Decisions

**Both hazard loops, not water only.** The defect is symmetric: a bunker ellipse saturates influence
the same way a water polygon does and can lose the same tie. Water's consequence is lethal and
sand's is only mechanical — a bunker that does not bog a cart down — but the fix is the same change
in both loops. Water-only was rejected because it produces a rule nobody can state: "the hole whose
placed hazard the point is inside owns it, unless that hazard is a bunker" is not a rule, it is an
unfinished one.

**Centredness of zero, not a third comparison key.** The alternative was to rank on influence, then
on hazard-containment, then on centredness — a three-level comparison. Rejected: two levels already
express it, the existing comparison stays one expression, and "inside the hazard reads as dead
centre" is the same claim stated in the vocabulary the function already has.

**Containment, not proximity.** Centredness collapses to zero only where the point is actually
inside the shape, not merely near it. A falloff on approach to a pond was rejected: it would make
ownership near a hazard depend on a second smoothstep with no geometric meaning, and the whole
purpose of a tie-break is to be decidable.

**The restored lethality ships as-is.** Those 8,824 m² were lethal before the September tie-break
landed; this restores the prior behaviour rather than introducing new difficulty. Softening drowning
in the same change was rejected: bundling a balance change with a correctness fix makes neither one
reviewable, and whether drowning is too punishing is a question for a play session with its own
decision.

**Scope stays the discrete channel.** Same bound as the predecessor, for the same reason. Nothing
here touches the weights.

**The decision record is amended, not appended.** The existing entry states that this consequence
"was accepted deliberately, not overlooked" and names the hazard-aware tie-break as open. That
paragraph becomes the record of a decision that was later reversed, with the reason — a second
consumer arrived — rather than being left standing as though it still described the code.

## Testing Decisions

**The failure the test must be able to detect:** a point inside a specific hole's water polygon,
inside the clubhouse apron, where a neighbouring hole's corridor is better-centred on that point,
reporting anything other than water.

**The existing water test cannot detect it, and that is the trap.** It finds its subject by scanning
the whole course for *any* cell that still reports water. A scan self-adapts to a shrinking pond —
it will keep finding some wet cell for as long as one exists, and pass. Any test that carries weight
here must **name its point by construction** — derived from a hole's own polygon, transformed into
course frame — never by search. This is the project's standing failure mode: a green test whose
assertion is satisfied by something other than the behaviour it is named for.

**What else would satisfy a naive assertion.** "The course reports more water than before" would be
satisfied by widening any pond, by a change in the grid, or by an off-by-one in the sampler. The
assertion that carries the weight is per-point and per-hole: *for every hole with placed water, a
point inside its polygon reports water.* That one is satisfied only by ownership being right at
those points, because nothing else decides the hazard channel.

**Area is the acceptance number, not the assertion.** Total reported water should return to the
neighbourhood of 39,972 m² — the pre-tie-break figure — measured the same way it was measured
before: real code, seed 2026, 2 m grid, full course bounds. It is reported in the commit as
evidence. It is not a unit test, because pinning an area to a constant would fail on any future
change to pond shape for reasons unrelated to ownership.

**The eighteen-cup assertion must be confirmed still green, not assumed.** Cups sit on greens rather
than in hazards, so in principle this change cannot reach them. "In principle" is what the previous
bug was hiding behind; run it.

**Red before green, and confirmed per hole.** Each hole carrying water is observed failing the new
per-point assertion before the fix and passing after. A suite that turns green all at once cannot
distinguish a rule that fixes every hole from one that fixes most and reaches the rest by accident.

**The gate re-baselines and that is expected.** The course-ground subject bakes its surface mask
from the same lookup, so 8,824 m² changing classification changes the picture. The gate is a render
check and is never evidence about simulation — its acceptance is a human picture review, and what it
is being reviewed for is that the ponds are visibly back.

**The terrain probe runs as a regression net,** as it must after any change to the assembly. An
unchanged control is the expected result and confirms the change stayed in the discrete channel.

## Out of Scope

- **The continuous weight channel.** Untouched, for the reason its predecessor gives.
- **Whether drowning is too punishing.** A balance question for a play session, deliberately not
  bundled here.
- **The scanning water test.** It stays. It is a reasonable smoke check for "the course has water at
  all"; it is simply not the evidence for this work, and its comment should say so.
- **Bridge ground.** `weights.bridge` is still computed and read by nobody; the crossing work owns
  that.
- **Pickup placement.** This unblocks it and does not deliver it.
