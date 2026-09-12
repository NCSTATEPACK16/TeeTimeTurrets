# Hole ownership near the clubhouse apron

Written 2026-09-12. Formalises the decisions settled by grilling in
`.scratch/cup-ownership-near-the-apron/prd.md`, which is this document's decision log and record of
what was rejected. Every decision below was settled by the user across three rounds; two questions
that looked like decisions were settled instead by measurement and are marked as such.

---

## Problem Statement

Three of the eighteen cups on the course sit on the wrong ground. Hole 9's cup reads `fairway`,
hole 18's reads `rough`, and hole 17's reads `water` — none of them read `green`, which is what is
actually built and drawn under a cup.

All three are inside the clubhouse apron, the region where the returning nines crowd together and
holes 1, 9, 10 and 18 all converge on the same ground. Material is not cosmetic in this project: it
drives the hazard mask, the mow-stripe direction, and the per-surface rolling resistance and bounce
scale that decide how a ball or a cart behaves on that ground. A cup that reads `water` is
therefore both drawn wrong and played wrong, and arena mode drives carts across exactly this
ground for up to three minutes a match.

The defect has been recorded but not fixed. It is held open by a deliberately failing test and
carried as a loose end, and it blocks work downstream: pickup placement is specified to ask the
same code which hole a candidate point belongs to, so scattering pickups on today's answer would
build new behaviour on a known-wrong foundation.

Separately, nothing currently proves any of this. The scene gate's course subject builds a
three-hole course, which falls back to the simple circular placement rather than the relaxation
solver the real eighteen-hole course uses. There is no returning nine in it and therefore no apron,
so the one automated check that looks at assembled course ground has never seen the region where
the bug lives.

## Solution

Ownership is decided by a single comparison that picks, for a given point, the hole with the
greatest influence over it. Influence saturates at one — a point well inside a corridor is fully
claimed by it — so where two corridors overlap, both holes report exactly one, the
strictly-greater test never fires, and the hole that happens to come first in iteration order wins.
Ownership near the apron is therefore an artefact of hole numbering rather than of geometry.

The fix replaces that undefined tie-break with a defined one: where influence ties, the owner is
the hole whose corridor the point is most centred in, measured as distance to the hole's spline
divided by that corridor's half-width. This is a general rule, not a special case for cups, and it
reads the same way the rest of the blend already reads — the corridor you are most centred in owns
you.

The change is confined to the discrete ownership channel. The continuous weight vector that the
same code returns is behaving as designed and is left untouched, which means assembled heights,
the blend, and the grade invariant cannot move.

Alongside the fix, the gate's course subject is extended from three holes to all eighteen, so the
one automated picture of assembled course ground finally contains the returning nines and the apron
that this work is about.

## User Stories

1. As a player putting out on hole 17, I want the ground under the cup to behave like a green, so
   that my ball rolls the way the green I can see says it should.
2. As a player driving through the apron in arena mode, I want the surface under my cart to match
   the hole I am on, so that my traction is not decided by a neighbouring hole's material.
3. As a player looking at the course, I want the mow stripes around a cup to run with that hole, so
   that the ground does not visibly belong to a hole I am not playing.
4. As a player, I want no cup to sit inside a hazard mask it should not be in, so that the course
   does not appear to have water where I am standing.
5. As a developer placing pickups course-wide, I want asking which hole owns a point to return a
   trustworthy answer, so that scatter placement is not built on a known-wrong foundation.
6. As a developer, I want ownership to be decided by a rule I can state in one sentence, so that I
   can predict what happens at any point on the course without tracing iteration order.
7. As a developer, I want the tie-break to be general rather than a special case for cups, so that
   the same defect cannot reappear at a tee, a bunker or a landing area inside the apron.
8. As a developer, I want the fix confined to the discrete channel, so that I can be certain
   assembled heights and the grade invariant have not moved.
9. As a developer, I want the change to be provably geometry-neutral, so that a green gate on
   geometry is real evidence rather than a coincidence.
10. As a reviewer, I want the existing failing test to invert to green as the signal the fix landed,
    so that I do not have to read the implementation to know it worked.
11. As a reviewer, I want each of the three named cups confirmed individually before the work is
    called done, so that a suite turning green cannot hide two fixes and one coincidence.
12. As a maintainer running the scene gate, I want the course subject to contain the returning
    nines, so that the check covers the region of the course where holes actually interact.
13. As a maintainer, I want the gate subject to use the real relaxation-solved layout rather than
    the circular fallback, so that the subject means what its name says.
14. As a maintainer, I want the extended gate to stay inside the standard build, so that nobody has
    to remember a separate command for the check to run.
15. As a maintainer, I want the extended gate not to slow the build enough that people start
    skipping it, so that the coverage gained is coverage actually exercised.
16. As a maintainer reviewing the new baseline, I want to see the course pictures once and approve
    them deliberately, so that a fresh baseline is a decision rather than a side effect.
17. As a future maintainer reading the assembly code, I want the reason behind the tie-break rule
    recorded where I would look for it, so that I do not undo it by simplifying the comparison.
18. As a future maintainer, I want the gate extension recorded alongside the rule, so that I can see
    what evidence was considered sufficient and why.
19. As a developer working downstream on pickups, I want this settled first, so that placement can
    ask about ownership without carrying a caveat.

## Implementation Decisions

**The tie-break rule.** Where two or more holes report equal influence over a point, the owner is
the hole with the smallest distance-to-spline measured as a fraction of that hole's corridor
half-width. Raw metric distance was rejected: it would hand contested ground to whichever hole
happens to be wider, which has nothing to do with whose hole a player is standing on.
Half-width-plus-blend-skirt was also rejected. The chosen quantity is the same one the existing
influence smoothstep is already built from, so no new geometry is introduced.

**The rule is general.** No special case for cups. A rule that fixed exactly the three known cups
and nothing else would be indistinguishable from a coincidence, and would leave the same defect
live at every other feature inside the apron.

**Scope is the discrete channel only.** The continuous weight vector — including the cubing and the
normalisation that applies where the sum exceeds one — is unchanged. Assembled heights already
discard the owner, so this bounds the change: geometry cannot move, and the grade invariant does
not need re-deriving.

**One notion of ownership, shared.** The mow-stripe direction, the hazard channel's sand/water/
bridge lookup, and the material lookup continue to read the same owner. Splitting them was
considered and rejected: a fix that corrected the material under a cup but left the mow stripes
pointing at a neighbouring hole would be visibly wrong in precisely the place just fixed.

**Terrain gains no knowledge of the clubhouse.** The apron radius stays a layout-side concept. The
chosen tie-break is geometry-local and needs nothing the terrain assembly does not already have, so
the assembly continues not to import it.

**The gate's course subject goes from three holes to eighteen.** A targeted subset containing only
the apron holes was rejected, because the routing solver closes the whole loop — a partial course is
a different course, not a window onto the real one. Eighteen is the only count that makes the
subject the thing it is named for.

**The extended subject stays inside the standard build.** The rule agreed in advance was to keep it
in the build if the extension cost under roughly twice the current gate wall time, and to split it
to its own script otherwise. *Measured rather than assumed:* the gate runs in 25.5 s at three holes
and 29.5 s at eighteen — 1.16×, well inside the budget. It stays in the build.

**The bake loop is untouched.** *Measured rather than assumed:* the subject's tiling loop is bounded
deliberately, and the concern was that roughly four times the geometry would no longer converge
inside that bound, silently pinning a half-tiled course into the new baseline. Running eighteen
holes with the bound raised eightfold produced identical vertex and triangle counts. The bake
converges well before the existing bound; the bound stays as it is.

**The re-baseline is deliberate.** Extending the subject changes its shape by construction —
roughly 4.4× the vertices and triangles, and a course footprint that grows from about 439 × 433 m
to 976 × 1196 m. This is a fresh baseline rather than a diff, so automated comparison has nothing
meaningful to compare against. The user reviews the new pictures once, on the extension commit.

**One decisions-record entry, covering both.** It records the tie-break rule and the gate
extension together: the rule because "the corridor you are most centred in owns you" is not
recoverable from the comparison that implements it, and the extension because it is the evidence
the rule works. It belongs with the existing account of how the course is assembled, which
currently explains the continuous channel and says nothing about the discrete one.

## Testing Decisions

**A good test here asserts external behaviour.** It asks what material the assembled course reports
under a cup, not how ownership was computed. A test that reached into the comparison would pin the
implementation and would have to be rewritten by anyone who changed the rule.

**One seam, and it already exists.** The course-assembly test asserts, through the same public
assembly call the game and the gate both use, that every one of the eighteen cups reports green.
This is the highest available seam: it covers ownership without reaching below the surface lookup,
and it is the shape both consumers already depend on. No new seam is introduced. A lower seam
asserting the owner index directly, and a synthetic two-corridor overlap testing the rule in
isolation, were both considered and rejected as unnecessary given the rule is general.

**The existing test inverts rather than being replaced.** It is currently marked as expected-to-fail
and asserts the correct behaviour. On the fix it turns green; the expected-fail marker is deleted
and the assertion stays. The test is not rewritten, relaxed, or re-framed around the broken values.

**Red is confirmed per cup, not per suite.** Before the work is called done, the three named cups —
9, 18 and 17 — are each observed going green individually. This is the project's standing rule that
a test must be seen failing for the right reason before it is made to pass, applied without adding a
test. It is also the specific guard against a rule that fixes two cups correctly and the third by
accident.

**The gate is a check, not a seam for this feature.** The project's house rule is that a render
check is never evidence about simulation. Extending the course subject buys coverage of the apron
geometry; it does not prove ownership is right. Its acceptance is the human picture review.

**The terrain probe runs as a regression net.** The project requires it after any change to the
assembly. An unchanged control is the expected result and is what confirms the change was confined
to the discrete channel.

**Prior art.** The expected-fail pattern used by the existing course-assembly test is the model for
holding a known defect visible, and its own comment records why it was chosen over skipping or over
asserting the broken values. The gate's per-subject metric and signature comparison is the model for
the extended subject.

## Out of Scope

- **The continuous weight channel and the blend.** Not touched. Any change there moves geometry and
  requires re-deriving the grade invariant.
- **The flat course rough.** The extended gate makes it measurable — an eighteen-hole course is only
  about 8% taller than a three-hole one — but adding course-scale macro relief moves every corridor
  grade and is its own decision.
- **Pickup placement.** This work unblocks it; it does not deliver it.
- **The crossing of hole 9's corridor and hole 1's near the clubhouse.** Inside the apron, forgiven
  by the clearance rule by design, and unrelated to material ownership.
- **Any change to how cups, tees or hazards are positioned.** Placement is correct; only the
  material lookup under them is wrong.
- **Extending the gate to cover routing or relaxation as such.** The subject gains the real layout as
  a consequence of going to eighteen holes, but layout correctness remains the routing tests' job.

## Further Notes

The defect's mechanism is worth stating plainly because it is easy to misread as a blending problem:
influence saturates, so inside overlapping corridors the comparison is between two identical values
and the winner is decided by iteration order. Nothing about the blend is wrong. The continuous
channel and the discrete channel coexist by design, and the design record already blesses that
split — what it never specified was what the discrete channel should do when the continuous one
flattens out.

The recorded argument that "a point does not belong to a field" is about height, not material, and
does not conflict with this work. Assembled heights discard the owner entirely.

Two open questions were closed by measurement rather than by asking, and both could have gone the
other way: the cost of the eighteen-hole gate subject, and whether the bake loop still converges
against the larger course. Both are recorded above with their numbers.

The handoff describing this bug frames the alternative as "explicitly decide three misdrawn cups are
acceptable and change the test's framing". That option was put to the user and closed: the fix is
one comparison and cannot move geometry, so the cost does not justify living with wrong ground under
a cup.
