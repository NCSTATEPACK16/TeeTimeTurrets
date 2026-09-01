# Concept art

Visual targets for the phases in `../ROADMAP.md`. Reference material only — **nothing in this
directory is loaded by the game**, and none of it is a step toward shipping bitmap assets.

That distinction matters because `AGENTS.md` states the rule absolutely: all playable geometry
is first-party procedural primitives, no `.glb`/`.obj`/`.fbx` in the playable path, ever. These
images are documentation of what that procedural geometry should *look like* when it is
assembled. `docs/` is outside the Vite build — nothing here reaches `dist/` — so adding to this
folder cannot accidentally violate the rule. If art is ever genuinely shipped (an `og:image`, a
title-screen backdrop), it goes in a `public/` directory at the repo root, not here, and that is
a decision worth making deliberately rather than by drifting files around.

## Naming

**`NN` + a free-form name + `.jpg`**, where `NN` is the two-digit prompt number. Only the
numeric prefix is load-bearing — it is what `../UI-SPEC.md` and `../ROADMAP.md` cite ("image
08"), and it is what keeps the folder sorted in shot order. Casing, separators and wording
after the number are not worth a rename pass over sixteen tracked binaries.

*(This rule was rewritten to match the files rather than the reverse. It previously specified
`NN-short-name.jpg`, which only `00` ever followed.)*

Keep one image per number — the chosen one. Iterations and rejects stay out of the repo; git
stores binaries badly and a folder of near-identical 3 MB frames is not worth the history.

**Size: under ~800 KB per file.** Met, and enforced before the first commit rather than after —
git keeps binaries forever, so this was the last cheap moment. Every image here is re-encoded
to **2048 px wide at JPEG quality 88**, which holds the callout text on the reference sheets
legible while taking the folder from ~34 MB to ~6.4 MB. The largest file is
`00-original-concept-sheet.jpg` at 728 KB; if a new shot lands above the bar, re-encode it at
those settings.

**Full-resolution originals (2752–2816 px) are deliberately not in this repo.** They live
outside it, alongside the working tree, because they are regenerable reference material and
not worth 28 MB of permanent history. If you need them, ask — do not re-add them here.

## Index

Sixteen distinct shots, 00–15. All are chosen; the set is complete.

| # | File | Shot | Notes |
|---|---|---|---|
| 00 | `00-original-concept-sheet.jpg` | — (pre-dates the shot list) | Source inspiration. 2D illustration, **not an in-engine target.** |
| 01 | `01Formlanguagesheet.jpg` | Form Language Sheet | Reference image #1 for every later prompt. Object scale relationships. |
| 02 | `02TheTeeShot.jpg` | The Tee Shot | Reference image #2 (environment). The swing HUD. |
| 03 | `03CartTurretChasecam.jpg` | Cart Turret Chase Cam | Chase-camera framing; the cart HUD. |
| 04 | `04RecoilLaunch.jpg` | Recoil Launch | Recoil as self-propulsion. Direction contradicts the spec — see below. |
| 05 | `05RagdollHit.jpg` | Ragdoll Hit | Targets are humanoid caddies; hit markers. |
| 06 | `06PickupsonCourse.jpg` | Pickups on Course | Pickup taxonomy, glow cylinders, ammo counter. |
| 07 | `07Flag_ballStruck.jpg` | Flag-ball Struck | Flag-ball scale, base zone rings, nameplates. |
| 08 | `08WaterHazard_fullHUD.jpg` | Water Hazard, Full HUD | **The maximal HUD.** The single most important shot for Phase 4. |
| 09 | `09Four_cart_Multiplayer.jpg` | Four-cart Multiplayer | Nameplates with health, four-team score strip. |
| 10 | `10TileScreen.jpg` | **Title** Screen | Filename says "Tile"; it is the title screen. Left as-is per the naming rule — the number is what's cited. |
| 11 | `11ClubhouseLoadout.jpg` | Clubhouse Loadout | Cosmetics taxonomy. Tire type is a stat, not a skin. |
| 12 | `12MatchLobby.jpg` | Match Lobby | The only place the three mode names appear together. |
| 13 | `13roundscorecard.jpg` | Round Scorecard | The four stat tiles that feed the economy. |
| 14 | `14iOStouchlayout.jpg` | iOS Touch Layout | The complete control surface; the mode-toggle reading. |
| 15 | `15Storekeyart.jpg` | Store Key Art | 2D, marketing only. Would ship from `public/`, never from here. |

Each shot's phase ownership and the elements it pins down are in `../UI-SPEC.md` §8.

### The art carries the old project name

The project was renamed from **CallofGolf** to **TeeTimeTurrets** in August 2026, after these
were generated. Image `00` shows a "Call of Golf" wordmark and `01`'s sheet was produced under
that name. The wordmark is baked into AI-generated pixels and is not worth regenerating the set
over — **it is not a branding reference and nothing should copy it.** Treat every image here as
depicting mechanics, not identity.

### Two duplicates, removed

Both were redundant and neither reached the first commit. Recorded so they are not re-added:

- **`Gemini_Generated_Image_4pho734pho734pho.jpg`** — was byte-identical to
  `06PickupsonCourse.jpg` (same MD5). An unrenamed original.
- **`01-form-language-sheet.jpg`** — was a 1376×768 downscale of `01Formlanguagesheet.jpg`.
  Same image, half the resolution.

### The shot list is missing

This file cites "the shot list" as the source of every prompt, and the provenance note below
tells anyone forking to regenerate from those prompts. **That document is not in the repo.**
Either check it in — it is plain text, it costs nothing, and it is the only thing that makes
the "regenerate your own" advice actionable — or stop citing it.

## Known deviations in what is here

Recorded so they are not mistaken for the spec. The full list, including the ones found by
reading 02–15, is `../UI-SPEC.md` §7 — that is the authoritative copy. Repeated here are only
the three that concern the images themselves:

- **`01` renders the CTF flag-ball undersized** — roughly a third of cart height instead of
  cart-roof height. The capture mechanic depends on the ball being too big to carry, so the
  built version follows the prompt, not this image.
- **`01` renders golf-ball dimples as carved indentations.** In-engine those become a flat dot
  pattern or nothing at all; there is no texture budget for them.
- **`00` is 2D vector illustration.** It is the tonal north star and the source of the HUD
  design language, but the 3D scene cannot look like it. See the shot list's opening note.
- **`04`'s recoil direction contradicts the mechanic.** Resolved in favour of the roadmap
  (recoil opposes the shot); reasoning in `../UI-SPEC.md` §7.

## Provenance and rights

Generated with Google Gemini (2.5 Flash Image) from the prompts in the shot list, August 2026.

These are **tracked by provenance rather than licensed**, and deliberately so. Copyright in
purely AI-generated images is unsettled — in the US, the Copyright Office and the courts have
held that material without human authorship is not copyrightable — so this project does not
claim a license it may not be able to grant. The `CC-BY-SA-4.0` line in `../../LICENSES.md`
covers assets authored by contributors, not these.

Practical consequence for anyone forking: treat this folder as reference documentation, not as
art you have been granted rights to ship. Re-generate your own from the prompts if you need
art you can stand behind. Nothing in the game depends on any of it.

If a human-authored image is ever added here — a hand-drawn sketch, a photo, a painted
mockup — record it in the index with its author and license, because that one *is*
copyrightable and does fall under the assets line in `LICENSES.md`.
