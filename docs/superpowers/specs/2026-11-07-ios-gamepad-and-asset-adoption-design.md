# iOS, gamepad and asset-pipeline adoption

Written 2026-11-07, from a design interview with the user. Each decision below was settled
question by question, and the recommended option was taken unless noted. **Do not relitigate.**
This becomes **Stage 4b** in `REVAMP-PLAN.md`: after Stage 4 (handling and zone), before Stage 5.

The trigger was a cross-game asset-pipeline note the user wrote for all their projects. Its
"CallofGolf" row is this game under its old name. §4 records which of its items this repo
adopts. Items marked **VERIFY** must be checked on a device before anyone relies on them.

## 1. Platforms

| Target | Input | Notes |
|---|---|---|
| Web (desktop) | Keyboard and mouse (today), **plus gamepad** | Same build. |
| iPhone 15/16/17 Pro class, M-series iPad | **Gamepad required in v1.** Test pad: 8BitDo SN30 Pro. | TestFlight via Xcode. No A-series iPad, no base iPhone in v1. |

- **Shell: Capacitor.** `vite build` output goes into a Capacitor iOS project, which runs it in
  WKWebView. One codebase. The web Gamepad API is the first choice. A native `GameController`
  bridge plugin is added only if WKWebView's Gamepad API falls short on the device. **VERIFY:**
  `navigator.getGamepads()` sees the SN30 Pro inside WKWebView on the test devices, and the
  pad's firmware and pairing mode work with iOS.
- **No controller connected:** a "Connect a controller" screen with pairing tips. The game goes on
  once a pad sends input. The touch layer (`BACKLOG.md` #34d, image 14) stays its own later stage.
- **Pointer lock does not exist on iOS.** `MatchScreen`'s pause-on-pointer-lock-loss
  (`MatchScreen.ts:122`) must only apply while keyboard and mouse is the active input. Otherwise
  the match pauses as soon as it starts on an iPad.

## 2. Controller (SN30 Pro: two sticks, digital L2/R2, no analog triggers)

### 2.1 Match layout ("shooter")

```
  L2 = brake                     R2 = fire (hold to charge)
  L1 = previous club             R1 = next club
  D-pad left/up/right = putter / iron / driver (direct)
  B  = cancel charge
  Left stick:  Y throttle, X steer
  Right stick: X turret yaw rate, with aim assist
  Select = map (as M)            Start = pause (as Esc)
```

- Use the Gamepad API's `standard` mapping. Read it through a binding table, as
  `intentFromKeys` does for keys, so the table is a pure, testable function of the button and
  axis state.
- A and X/Y have no match action in v1, so they stay free for later (for example a horn or emotes).

### 2.2 Aim

- **Twin-stick rate aim.** The right stick's X axis gives a yaw rate, with a radial deadzone and a
  response curve (start with exponent about 2). The peak rate is a tuning constant. Begin near the
  keyboard's 1.6 rad/s and tune by feel.
- **Aim assist lives in the input layer, never in the sim.** It may only scale the `aimDelta`
  the source emits (slowdown when the reticle is near a visible enemy). It reads render-side state
  (the camera, the visible carts) and writes nothing back. The sim, the bots, the golden
  fingerprint and a future server never know it exists. Assist must be off for keyboard and mouse.
- `PlayerIntent` does not change. If `GamepadSource` needs an intent field that doesn't exist, the
  input interface was designed wrong (`ARCHITECTURE.md`). Stop and raise it.

### 2.3 Menus

- **Full controller navigation on every DOM screen:** title, clubhouse/loadout, settings, results
  and pause. That means a D-pad and left-stick focus move, A to confirm, B to go back and a
  visible focus ring. Touch taps keep working.
- **Button glyphs follow the last input used:** SN30 Pro labels after the pad, key names after
  the keyboard.
- Focus movement is a pure function (a screen's focusable list plus a direction gives the next
  index), so it gets one colocated Vitest smoke check.

## 3. Frame rate and thermals

- **Render uncapped, so 120 Hz on ProMotion.** The sim stays at `FIXED_DT = 1/60`. `GameLoop`
  already interpolates with `alpha`, so no sim change is needed.
- **Governor:** if the p95 frame time stays above 8.3 ms for about 5 s, lock rendering to a steady
  60 for the rest of the match. Try 120 again at the next match. The perf overlay shows the
  current mode. The governor is render-side only, and its window must not allocate per frame.
- The quality preset is picked automatically per device as today. The **MacBook Neo (A18 Pro, the
  iPhone 16 Pro's chip)** is the dev-time performance proxy for the iPhone. **VERIFY** it against
  a real device once, early.

## 4. Asset pipeline: what this repo adopts from the cross-game note

| Item | Decision | Detail |
|---|---|---|
| GIS terrain (OSM, DEM) | **Not adopted** | The course is authored and procedural, and the sim reads it (`COURSE_PIPELINE.md`). |
| Props as GLB, PBR realism | **Not adopted** | The playable/decorative split (`ASSET_PIPELINE.md` §1) and the soft-bevelled style (P1–P6) stand. |
| **KTX2 terrain textures** | **Adopt** | The 15 CC0 JPGs in `public/textures/terrain/` total about 19 MB and are not loaded by `src/` yet (Stage 5's ground splat wants them). Uncompressed, they cost about 80 MB of GPU memory once wired. Convert them with a script (`tools/textures/` or `scripts/`) to KTX2/Basis: UASTC for normal maps, ETC1S for colour and roughness. Load with `KTX2Loader`, which transcodes to ASTC on iOS. Keep the CC0 sources out of the shipped `public/`. **VERIFY** that `toktx` (KTX-Software) installs on the Mac; if not, the conversion runs in CI or on the Windows PC. |
| **CI size budget** | **Adopt** | New `docs/ASSET_BUDGETS.md`, plus a fast check (under 15 s) in `npm test` or `ci.yml` that fails when the total `dist/` size or any single asset exceeds its budget. It protects the Capacitor bundle as well as the web deploy. Start with the total `dist/` budget at the measured size plus 10% after the KTX2 swap, and any single file under 5 MB. |
| **Headless Blender CLI** | **Adopt, lower priority** | A `blender --background --python` entry point that runs `art/stage*_kit.py` → `build_all(); export_all(REPO)`. Then the Windows PC or CI can rebuild graphs without the MCP. The output must be byte-identical to the MCP export (`git diff --stat src/entities/graphs/` is empty). |
| **Poly Haven HDRI** | **Adopt** | One CC0 HDRI (1K, about 1–2 MB, ideally KTX2 or RGBE-in-JPG) as the environment map for the clubhouse turntable and menus only. Record it in `LICENSES.md` when it's added. Not used in the match lighting unless a later stage asks for it. |

## 5. Order inside Stage 4b

1. **`GamepadSource` (web)**, with the binding table, the stick curves and a pure, tested
   mapping. You can play-test it on desktop Chrome or Safari with the SN30 Pro over Bluetooth or
   USB before iOS exists.
2. **Input-aware pause.** Pointer-lock loss pauses only for keyboard and mouse.
3. **Menu focus navigation and glyphs.**
4. **Aim assist** (render side, scales `aimDelta`).
5. **KTX2 conversion and the size-budget check.** These are independent of 1–4 and can be done
   in any order.
6. **Capacitor iOS shell**, the controller-required screen, and the 120/60 governor. The Xcode
   and TestFlight steps run on the user's Mac. The cloud session produces the project and the
   instructions.
7. **The headless Blender CLI and the HDRI.** Last. Neither blocks iOS.

Each slice gets one smoke check of 15 s or less, per `AGENTS.md`. Play-test items: drive, aim,
charge-fire, cancel and cycle clubs on the pad at `?match=60`. Navigate title → loadout → match →
results with the pad only. On iPhone, play two matches back to back and watch the governor.

## 6. Open (VERIFY on device)

- Does the SN30 Pro appear through `navigator.getGamepads()` in WKWebView, with `mapping === "standard"`?
- Does iOS deliver Select/Start/Home to the page, or does the OS take them? Home is reserved, so
  never bind it.
- How fast does the Neo, and a Pro iPhone, drop from 120 to 60 under the governor in a 3-minute match?
- Does `toktx` install on the Mac?
