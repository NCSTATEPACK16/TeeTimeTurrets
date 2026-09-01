# Contributing to TeeTimeTurrets

This project is early (Phase 0 of 5 — see `docs/ROADMAP.md`) and its conventions are still
settling, but the load-bearing ones are already enforced:

1. **Read `AGENTS.md` first.** It covers unit conventions, the sim/render boundary, the
   no-per-frame-allocation rule, and — importantly — a license-boundary note about this
   project's architectural reference material (a separate repo with a mixed MIT/proprietary
   license). Don't port code from that reference repo's Reserved Content paths.
2. **`npm run build` (`tsc --noEmit` + build) must be clean before opening a PR.** `strict`,
   `noUnusedLocals`, `noUnusedParameters` are all on deliberately.
3. **`src/sim/**` and `src/physics/**` stay engine-agnostic and deterministic:** no `three`
   import, no `window`/`document` reference, no `Math.random()` — randomness in those
   directories takes an injected, seeded generator (see `Ballistics.applyAimSpread` for the
   pattern). This is what keeps a future multiplayer server a matter of running the same
   module in Node rather than a rewrite.
4. **All geometry is procedural primitives.** No `.glb`/`.obj`/`.fbx` in the playable path —
   see `src/entities/GolfClub.ts` for the pattern (boxes/cylinders/spheres assembled and
   parameterized in code).
5. **Follow the phase gates in `docs/ROADMAP.md`.** Each phase lists what must pass before
   the next one starts — a PR that jumps ahead of the current phase (e.g. multiplayer code
   before the cart/turret mechanic in Phase 2 is stable) is likely to get asked to wait.
6. **Claim before you build, for anything non-trivial.** Open an issue describing what
   you're planning before sending a large PR, to avoid duplicated or conflicting work — this
   project is small enough that a quick heads-up saves everyone time.
7. **Sign off every commit** (`git commit -s`). See "Licensing and sign-off" below — this is
   a hard requirement, and a PR without it will be asked to amend.

## Licensing and sign-off

TeeTimeTurrets is **split-licensed by directory**: `src/**` and `tools/**` are Apache-2.0,
`server/**` is AGPL-3.0-or-later. `LICENSES.md` has the full map and the reasoning; read it
before contributing to `server/`, because the license your patch lands under depends on where
the file lives, not on what the patch does.

One rule follows from the split and is easy to get wrong: **AGPL code may import Apache-2.0
code, never the reverse.** Anything both halves need belongs in `src/sim/**` or
`src/physics/**` and gets imported by the server.

### Developer Certificate of Origin

Every commit must carry a `Signed-off-by` line:

```
git commit -s -m "your message"
```

which appends:

```
Signed-off-by: Your Name <your.email@example.com>
```

That line is your statement that you wrote the contribution or otherwise have the right to
submit it under this project's licenses — the full text is the Developer Certificate of
Origin 1.1, <https://developercertificate.org/>. Use a real name and a real email; `git
config user.name` / `user.email` set them once.

This is a DCO, **not a CLA**. You keep your copyright, you assign nothing, and it costs you
one flag. The reason it is required from the first commit rather than added later: if the
license boundary ever needs to move, doing so requires consent from every copyright holder,
and that conversation is only tractable if provenance was recorded all along. Projects that
have done this migration — Space Station 14 is the closest comparable — track the missing
consent as an open issue years afterward. Cheap now, expensive never.

### Porting code from elsewhere

If your patch is derived from another project, say so in the PR and add the attribution entry
to `NOTICE` in the same PR. MIT and Apache-2.0 both permit reuse but require the notice to
travel with the code. A reimplementation written from a public interface is not a derivative
work and needs no entry; a close port is and does. If you can't tell which you wrote, treat it
as a port.

Nothing may be ported from the Claude of Tanks Reserved Content paths under any
circumstances — the enumerated list is in `AGENTS.md`.

## Reporting bugs / suggesting features

Open a GitHub issue. For a physics/feel bug, include what you did (aim/charge/club, if
relevant) and what you expected versus what happened — "the ball tunneled through terrain
at X" is far more actionable than "physics is broken."
