# Asset budgets

Written 28 Nov 2026 (Stage 4b, spec §4). The budget protects the web deploy and the iOS app, which
ships the same `dist/`. `npm run build` ends with `tools/sizeBudget.mjs`, so a build over budget
fails, and with it the Netlify deploy preview on a pull request. The rules are tested by
`tools/sizeBudget.test.mjs` in `npm test`. CI does not build, by design (`.github/workflows/ci.yml`).

| Budget | Limit | Measured 28 Nov 2026 |
|---|---|---|
| All of `dist/` (game and free drive) | 28,000,000 bytes | 25,420,080 (60 files) |
| Any one data file (textures, level data, models) | 5 MiB | 5,242,880: `textures/ground/normal.bin`, exactly at the limit |
| Any one JavaScript chunk | 6 MiB | 5,546,245: `drive/assets/index-*.js` |

The numbers live in `BUDGET` in `tools/sizeBudget.mjs`; change both together.

## Why these numbers

- **Total:** the measured size plus 10%, as the spec asks. The spec meant to measure after the KTX2
  swap. That has not happened yet (below), so the total should drop once it does. Lower it then.
- **A data file:** the spec's 5 MB. `normal.bin` sits exactly on it today. KTX2 should take it well
  under.
- **A JavaScript chunk:** the spec's single-file rule did not foresee code. Free drive's app is one
  5.3 MiB chunk. That is worth splitting (it is the "single 3.6 MB chunk" perf item in
  `SPEC-QUEUE.md`, grown), but not in this stage, so scripts get 6 MiB until it is.

## KTX2 (not yet swapped in)

`tools/textures/groundKtx2.mjs` converts the two ground arrays to KTX2: UASTC for normals and
roughness, ETC1S for detail, both marked linear. It needs KTX-Software's `toktx`, which the cloud
session that wrote it did not have, so it has never run. Its ImageMagick half was checked: it
splits a layer of each array into a correct PNG.

To finish it, on a machine with `toktx`:
1. Run `node tools/textures/groundKtx2.mjs` (or `--dry-run` to see the commands).
2. Switch `loadGroundTextures` (`src/render/groundTextures.ts`) to `KTX2Loader` for the two arrays,
   with the Basis transcoder from `three/examples/jsm/libs/basis/` copied into `public/`.
3. Look at the ground on a device. Then delete the `.bin` files, re-measure, and lower the total
   above to the new size plus 10%.
