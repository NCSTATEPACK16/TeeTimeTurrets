# Licensing

TeeTimeTurrets is split-licensed by directory. This is deliberate and it is the one decision in
the project that cannot be walked back after publication, so it is settled before the first
release rather than at Phase 5.

## The map

| Path | License | SPDX |
|---|---|---|
| `src/**` (client, engine, sim, physics, render, ui) | Apache License 2.0 | `Apache-2.0` |
| `tools/**` | Apache License 2.0 | `Apache-2.0` |
| `index.html`, build config, `docs/**` | Apache License 2.0 | `Apache-2.0` |
| `server/**` | GNU Affero General Public License v3.0 or later | `AGPL-3.0-or-later` |
| Human-authored assets, if any are ever added | Creative Commons BY-SA 4.0 | `CC-BY-SA-4.0` |
| `docs/concept/**` (AI-generated reference art) | No license claimed — provenance-tracked | — |

Full texts: `LICENSE` (Apache-2.0) and `server/LICENSE` (AGPL-3.0). Attribution and
third-party notices: `NOTICE`.

## Why split

**The client half is Apache-2.0 to be maximally liftable.** The procedural geometry, the
fixed-step loop, the ballistics math, and the surface model are the parts other people will
want to learn from and reuse. Nothing should stand in the way of that.

Apache-2.0 rather than MIT for one reason: it carries an explicit patent grant that MIT
lacks. For a golf game this is close to theoretical, but it costs contributors nothing and
removes a category of risk that some downstream users are required to care about.

**The server half is AGPL-3.0 because the "run as a service" trigger actually applies here.**
For a purely client-side game, AGPL and GPL are equivalent in practice and the distinction is
academic. For a networked multiplayer game server it is the whole point: anyone who runs a
modified TeeTimeTurrets server for other people has to publish their modifications. That is the
outcome the split exists to produce.

This mirrors what the closest comparable projects settled on. lichess (`lila`) runs AGPL-3.0
and sustains a large outside-contributor base. Space Station 14 — a multiplayer game with a
server component and an active fork ecosystem, which is nearly this project's exact shape —
relicensed MIT to AGPL-3.0 in August 2024 and its downstream forks followed.

## The cost, stated plainly

AGPL is not free of friction and the trade is worth naming rather than discovering later:

- **Some large companies maintain blanket internal bans on AGPL.** Under some of those
  policies an employee cannot contribute to an AGPL repository even on their own time. For a
  hobby project this is a rounding error, but it is a real cost and it is being paid
  knowingly.
- **It constrains later relicensing.** Changing the license of existing code requires consent
  from every copyright holder. The DCO in `CONTRIBUTING.md` preserves provenance so that
  conversation is at least *possible*; it does not make it automatic.
- **Permissive is irreversible in the other direction.** Anything published under Apache-2.0
  stays Apache-2.0 forever. Someone can fork the last permissive commit and continue under
  those terms no matter what the project does afterward. This is understood and accepted for
  `src/**`; it is precisely what is being avoided for `server/**`.

## If the boundary ever moves

Space Station 14's mechanism is the proven pattern and the one to copy if a directory ever
needs to change license: pick a commit, declare that everything before it keeps the old
license and everything after it takes the new one, ship both LICENSE files in the repo, and
track per-file provenance. It works, but only with consent from contributors — which is the
argument for getting the boundary right now, while the contributor list is short.

## A note on the concept art

`docs/concept/**` is deliberately absent from the grant above. Copyright in purely AI-generated
images is unsettled — in the US, material without human authorship is not copyrightable — so
this project records how those images were made instead of claiming terms it may not be able to
grant. They are reference documentation, nothing in the game loads them, and a fork that wants
art it can stand behind should re-generate its own from the prompts. Details and the per-file
index are in `docs/concept/README.md`.

The CC-BY-SA line above applies to assets a human actually authored. If one is ever added,
record its author and license in that index, because that one genuinely does fall under it.

## What this does not cure

The Claude of Tanks repository used as architectural reference is MIT **with a Reserved
Content carve-out**. This project's license choice has no bearing on that. A Reserved Content
overlap would be a problem under any license TeeTimeTurrets picks. See the License note in
`AGENTS.md` for the enumerated Reserved paths, and `docs/REUSE-MAP.md` for what is and is not
a legitimate reuse target.

The name "TeeTimeTurrets" is a trademark question, not a copyright one, and is entirely separate
from everything above. It remains open, but is much smaller than it was: the project was renamed
from "CallofGolf" on 31 Aug 2026, retiring the phonetic-play concern that made it urgent. See
`docs/DECISIONS.md` and `docs/RESEARCH-FINDINGS.md` flag-back 5, which is preserved under
the old name on purpose.
