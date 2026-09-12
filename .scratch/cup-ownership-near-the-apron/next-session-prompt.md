Implement GitHub issues #22, #23 and #24 on this repo (NCSTATEPACK16/TeeTimeTurrets):
hole ownership near the clubhouse apron, and widening the scene gate's course subject.

You are orchestrating. Dispatch **Sonnet subagents** to do the implementation work
(`subagent_type: "general-purpose"`, `model: "sonnet"`), one per task, and review their work
yourself between tasks. Use the `superpowers:subagent-driven-development` skill to run this —
fresh subagent per task, two-stage review, you hold the thread.

## Read before dispatching anything

- `docs/superpowers/plans/2026-09-12-hole-ownership-near-the-apron-implementation.md` — the
  task-by-task plan. It carries real code, exact line references and stop conditions. Follow it.
- `docs/superpowers/specs/2026-09-12-hole-ownership-near-the-apron-design.md` — the spec the plan
  argues from, including what was rejected and why.
- `AGENTS.md` and `docs/TEST-AND-SPEC-PITFALLS.md` — house rules and this repo's named recurring
  defects.
- `docs/DECISIONS.md`, the section on assembling the course ("influence, not a mosaic") — required
  reading before touching the terrain assembly.
- `.scratch/cup-ownership-near-the-apron/prd.md` — the decision log, if a subagent questions why
  something was chosen. Every decision in the spec was settled by the repo owner across three
  rounds of grilling; none of them are open for a subagent to relitigate.

Use jCodemunch MCP tools for code navigation per CLAUDE.md — `resolve_repo` first (this repo
indexes as its own root, not as part of the parent folder), then `search_symbols` /
`get_file_outline` / `get_symbol_source`. Use `Read` only on a file you are about to edit.

## Before task 1: commit the paperwork

The spec, the plan and `.scratch/` are currently untracked. The issues cite the spec by path, so
commit them first or a fresh clone cannot follow the references. Ask the repo owner whether
`.scratch/` should be committed or gitignored — it is a working decision log, and that is their
call, not yours.

## Sequencing — strict, and the order is load-bearing

**#22 → #23 → #24.** Do not parallelise these and do not reorder them.

- #23 must not land before #22. If the gate subject is widened first, the regenerated baseline
  bakes in the *bug* — wrong mow stripes and hazard masks around three cups — and fixing ownership
  afterwards forces a second re-baseline and a second human picture review.
- #24 is blocked by both because it deliberately records the rule and its evidence in one entry.

## Hard constraints — these override a subagent's judgement

- `src/sim/**` and `src/physics/**` are **DOM-free**, enforced by the Vitest node environment.
- **No allocation in query paths.** `weightsInto` and `influenceLocal` are called hundreds of
  thousands of times by `buildHeightfield`. Use closure-owned scratch — the existing pattern in
  that module. A subagent that "cleans this up" by returning an object has broken it.
- **Never `Math.random()` in `src/sim/**`.**
- **Get a test to fail for the right reason before making it pass.** This repo's §1 recurring
  defect is "a test that passes for a reason unrelated to its name". Task 1's per-cup red
  confirmation exists specifically to guard against a rule that fixes two cups correctly and the
  third by accident — do not let a subagent skip it or collapse it into "the suite went green".
- **A render check is never evidence about simulation.** `npm test` and `npm run probe` settle
  physics; `npm run gate` and `npm run smoke` settle presentation. The widened gate in #23 buys
  apron *coverage*; it does not prove ownership is right.
- **Do not touch the continuous weight vector**, its cubing, or its normalisation. The fix is
  confined to the discrete owner channel. `npm run probe:terrain` reporting an unchanged control is
  the evidence this held.
- **Do not add a test at a lower seam.** The spec settles this: one seam, the existing one in
  `courseWorld.test.ts`. The scratch test in Task 1 is temporary evidence and must be deleted
  before the commit — check `git status` for it.
- **Before any `Write`, confirm the file is actually new** via `git status` or `ls`, not a symbol
  search. A previous session nearly destroyed `matchScoreboard.ts` by trusting an empty search as
  proof of absence.

## Stop conditions — report to the repo owner rather than pushing through

- **Task 1, Step 2:** if the failing cups are not exactly holes 9, 17 and 18, stop. The spec's
  premise is those three; a different set means the course or seed moved and the plan needs
  revisiting.
- **Task 1, Step 9:** if `npm run probe:terrain`'s control moved, the change reached geometry. The
  fix is wrong — do not re-baseline the probe to make it pass.
- **Task 1, Step 10:** if the three-hole gate subject moves at all, ownership changed somewhere with
  no overlapping corridors. Investigate before continuing.
- **Task 2, Step 3:** the decision to keep the gate inside `npm run build` was made against a
  measured 1.16× (25.5s → 29.5s). If it lands materially above ~2× on this machine, stop and report
  — that decision was conditional on the number.
- **Task 2, Step 6:** **this issue cannot be closed by an agent.** The baseline is fresh rather than
  a diff, so automated comparison has nothing to compare against. Surface the regenerated
  `course-ground` picture to the repo owner and name what to look for: eighteen holes present, the
  returning nines converging on the clubhouse, mow stripes running with their own holes near the
  apron, no water or sand mask under a green. Do not commit until they approve.

## What to tell each subagent

Give each one the plan path, its single task number, and the hard constraints above. Do not give a
subagent more than one task. Require it to report: the commands it ran, their actual output, and
what it did *not* do. Treat "all tests pass" with no pasted output as unverified — this repo's
pitfalls doc has a section on reports that grade their own work.

## Verification before you accept any task as done

```
npx tsc --noEmit
npm test
npm run probe:terrain     # after task 1
npm run gate              # after tasks 1 and 2
npm run build             # after task 2 — tsc, vite build, then the gate
```

`npm run probe` is expected to exit 1 on the driver-distance line alone; that is a known open issue
and not a regression. Do not read a red probe as this work's fault without checking it is still
only that line.

## Done when

All three issues are closed, each by a commit that references it, with #23's picture review
actually granted by the repo owner rather than assumed. Report the commit SHAs and paste the final
verification output.

Do not start Stage D (pickups) — it is specified separately and was deliberately sequenced after
this work so placement is not built on the wrong ownership answer.
