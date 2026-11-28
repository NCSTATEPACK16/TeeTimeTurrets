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
| `src/vendor/cot/**` (third-party, from Claude of Tanks) | MIT, notice in `src/vendor/cot/LICENSE` and `NOTICE` | `MIT` |
| `reference/claude-of-tanks/**` (reading material, not built) | MIT, notice in that folder's `LICENSE` | `MIT` |
| `art/textures-src/**` and `public/textures/ground/**` (ambientCG / Poly Haven, and files packed from them) | Public domain | `CC0-1.0` |
| `public/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` (Poly Haven, "Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal, sky edits by Jarod Guest; downloaded 28 Nov 2026; the clubhouse turntable's environment only) | Public domain | `CC0-1.0` |
| `drive/**` (free drive: its app, course pipeline and docs) | Apache License 2.0, except the rows below | `Apache-2.0` |
| `drive/pipeline/courses/tee-time-links/**` and the packet built from it, `drive/apps/web/public/levels/tee-time-links/**` | Third-party data (NC lidar and orthoimagery, OSM); see "A note on free drive's course" and `drive/ATTRIBUTION.md` | — |
| Shrikhand and Rubik fonts (`@fontsource/*`, bundled into the build; also in `drive/`) | SIL Open Font License 1.1 | `OFL-1.1` |
| `art/brand/tee-time-links.svg` (the Tee Time Links logo; Shrikhand lettering converted to outlines) | First-party artwork; see "A note on the Tee Time Links logo" | — |
| `ios/**` (the Capacitor iOS shell, Stage 4b) | Apache License 2.0 for this project's changes; generated from Capacitor's iOS template, MIT, notice in `NOTICE` | `Apache-2.0` AND `MIT` |
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

## A note on the course routing

**The eighteen holes in `src/sim/authoredCourse.ts` are traced from a real course: Caswell Pines
Golf Club, North Carolina, from its White tees.** This is recorded rather than left implicit,
because the alternative — shipping a real club's routing under another name and saying nothing — is
a thing done by drift rather than by decision.

**What was taken** is the routing skeleton: hole order, par, White-tee yardages, roughly where each
hole sits and which way it plays, which holes touch water, and the clubhouse's position on the
southern boundary. These are facts about a layout. They are the kind of thing a scorecard prints
and a spectator can pace out, and they are weakly protected at best.

**What was not taken, and is not in this repository:** the plat drawing the routing was read off.
That drawing is a third-party work, it is not committed, it is not distributed with this project,
and it must not be added — the same rule, for the same reason, that keeps `concept-originals-fullres/`
out of the tree. Nor are the subdivision's housing lots, its roads, its cul-de-sacs, or its practice
range, none of which are golf and none of which were traced.

**What is first-party** is everything under the routing: terrain noise, greens, bunkers, water
shapes, trees and the rough are all generated from a seed by this project's own code, exactly as
they were before the routing was authored. The hole *shapes* are fitted approximations — the source
plat has no scale bar, so lengths come from the scorecard and only each hole's bend was read off the
drawing. No geometry was copied.

Terms: no licence is claimed over the routing facts, and none is granted. If Caswell Pines objects,
the remedy is to perturb the routing — the card and the returning-nines structure are what make the
course play like a real one, and neither requires *that* course.

## A note on free drive's course

**Free drive (`drive/`) ships its course as Tee Time Links, a fictional name with no club logo.** Its
terrain is the NC 2024 QL1 lidar of a real Piedmont NC golf course (Caswell Pines, the same course the
arena's routing note above describes), its layout is traced over NC OneMap orthoimagery
(`drive/pipeline/courses/tee-time-links/aerial/ortho.tif`, committed as the tracing base, never shipped
in a packet), and it uses an OpenStreetMap snapshot. The club's name and logo were used with its
permission until 2026-11-25 and are now removed, so the game stands on its own. Sources and terms are
in `drive/ATTRIBUTION.md`. Still open before a public release:

- **The NC lidar and the NC OneMap orthoimagery** are NC public data whose exact terms are unconfirmed.
- **OpenStreetMap** data is under the ODbL 1.0, with attribution in the game's credits.

The Apache-2.0 grant on `drive/**` covers this project's own code and docs, not that data. If a source
goes the wrong way, the pipeline rebuilds the packet from whatever sources remain.

## A note on the Tee Time Links logo

`art/brand/tee-time-links.svg` is drawn in this repository, from the title art's own shapes. Its
lettering is **Shrikhand** (Jonny Pinhorn, SIL Open Font License 1.1), converted to outlines by
`art/brand/tee_time_links.py` from the `@fontsource/shrikhand` files, so the SVG carries no font and
no `<text>`. The OFL allows this: a logo made with an OFL font is artwork, not Font Software, and the
licence does not extend to it. Shrikhand declares no Reserved Font Name. The font is credited in
`NOTICE` either way, because the game also bundles it as a webfont.

## Shipped 3D assets

One mesh file ships, and it is decorative under `docs/ASSET_PIPELINE.md` §1: nothing collides
with it, nothing replicates it, and no code under `src/sim/**` reads it. Everything playable —
cart, clubs, ball, targets, terrain — remains first-party procedural primitives assembled at
runtime, with no mesh file anywhere in that path.

| File | What | Provenance | Terms |
|---|---|---|---|
| `public/models/clubhouse.glb` | Clubhouse interior behind the loadout turntable. ~29 boxes, 324 tri, 16 KB. | First-party. Authored in Blender in this repository via the Blender MCP, following `ASSET_PIPELINE.md` §6, from `docs/concept/11ClubhouseLoadout.jpg` as visual reference only — no generated geometry, nothing traced, nothing imported. | Same grant as the rest of the first-party assets (CC-BY-SA-4.0). |

The source is the Blender scene, not the `.glb`: re-author and re-export rather than editing the
binary. The `.glb` is build output that happens to be committed because there is no asset build
step and one 16 KB file does not justify inventing one.

## Terrain textures (CC0)

Photoscanned PBR sets in `art/textures-src/`, at 1K JPG, with colour, OpenGL normal and roughness maps only. All are CC0 1.0 (public domain) from their original publishers. All but Ground077 were taken from the copies in the Claude of Tanks repository, whose `LICENSE-POLICY.md` leaves third-party material under its original licence. `public/textures/**` is not in its Reserved Content list. Ground077 was downloaded from ambientCG directly.

| Set | Files | Source | Use |
|---|---|---|---|
| Grass004 | `Grass004_1K-JPG_{Color,NormalGL,Roughness}.jpg` | ambientCG, CC0 | mown grass: green, fairway |
| withered_grass | `withered_grass_{diff,nor_gl,rough}_1k.jpg` | Poly Haven, CC0 | rough |
| Ground093C | `Ground093C_1K-JPG_{Color,NormalGL,Roughness}.jpg` | ambientCG, CC0 | sand/bunker candidate (verify visually) |
| Ground071 | `Ground071_1K-JPG_{Color,NormalGL,Roughness}.jpg` | ambientCG, CC0 | clay: bare banks |
| Ground077 | `Ground077_1K-JPG_{Color,NormalGL,Roughness}.jpg` | ambientCG, CC0, https://ambientcg.com/view?id=Ground077, fetched 22 Nov 2026 | pine straw under the woods |

CC0 requires no attribution. It is recorded here so provenance is auditable.

**The sources are not shipped.** `tools/textures/packGround.mjs` (`npm run pack:ground`) reads them and writes what the game loads: `public/textures/ground/detail.bin`, `normal.bin` and `ground.json`, five layers at 512 px. Those files are derived from the sets above and nothing else, so they are CC0 too. The `Rock058` set was removed on 15 Nov 2026; nothing used it.

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
