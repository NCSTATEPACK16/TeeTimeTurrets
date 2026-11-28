# The iOS app (Stage 4b)

TeeTimeTurrets on iPhone and iPad is the same web build, run in a Capacitor shell (WKWebView). The
project is `ios/`, generated on 28 Nov 2026 by `cap add ios` with Capacitor 8.6.3. It uses Swift
Package Manager, so CocoaPods is not needed. The web build is copied into it by `cap sync` and is
not committed (`ios/.gitignore`).

v1 needs a game controller: there are no touch controls yet (`BACKLOG.md` #34d). With none
connected, the app shows a "Connect a controller" card until a pad sends input.

## What was built here, and what was not checked

The project was generated and edited in a Linux cloud session. **Nobody has built it in Xcode or
run it on a device yet.** Everything below is the first time it meets a Mac. If a step fails,
note what it said; the fix is likely small.

## First build on the Mac

Needs Xcode (current release), an Apple ID signed into Xcode, and for TestFlight a paid Apple
Developer Program membership.

1. Get the branch and its dependencies:
   ```
   git pull
   npm ci
   ```
2. Build the game and copy it into the iOS project:
   ```
   npm run ios:sync
   ```
   This runs `npm run build` (typecheck, the web build and free drive) and then `cap sync ios`.
3. Open the project in Xcode:
   ```
   npm run ios:open
   ```
4. In Xcode, select the **App** target, then **Signing & Capabilities**:
   - Team: your team.
   - Bundle Identifier: change `com.teetimeturrets.app` to one you own, for example
     `com.<yourname>.teetimeturrets`. Change `appId` in `capacitor.config.json` to match, so the
     next `cap sync` keeps it.
5. Plug in the iPhone (or pick it over Wi-Fi), choose it as the run destination, and press Run.
   The first run asks you to trust the developer profile on the phone: **Settings › General ›
   VPN & Device Management**.
6. Pair the 8BitDo SN30 Pro in **Settings › Bluetooth**, using the pairing mode its manual gives
   for Apple devices. Open the game and press any button.

After any change to the game: `npm run ios:sync`, then Run again in Xcode.

## TestFlight

1. In Xcode: **Product › Archive** (with "Any iOS Device (arm64)" as the destination).
2. In the Organizer that opens: **Distribute App › App Store Connect › Upload**.
3. In App Store Connect, create the app record if this is the first upload (the bundle id from
   step 4 above), wait for the build to process, then add yourself as an internal tester under
   **TestFlight**.

## What the shell sets (`ios/App/App/Info.plist`)

| Key | Why |
|---|---|
| Landscape only, `UIRequiresFullScreen` | The game is landscape. |
| `UIStatusBarHidden` | Full screen. |
| `CADisableMinimumFrameDurationOnPhone` | Lets a ProMotion iPhone run above 60 Hz. Without it iPhones are held to 60. |
| `GCSupportsControllerUserInteraction`, `GCSupportedGameControllers` (ExtendedGamepad) | Declares controller support to iOS and the App Store. |
| `UIRequiredDeviceCapabilities`: `arm64` | The template said `armv7`, which no supported device is. |

## To verify on the device (spec §6)

Fill these in on the first run. They decide whether a native controller plugin is needed.

| Question | Answer |
|---|---|
| Does the SN30 Pro show up in WKWebView's `navigator.getGamepads()`, with `mapping === "standard"`? | Open (needs a device). |
| Are its A and B where the game expects (A on the right, B at the bottom)? | Open. |
| Do Select and Start reach the page, or does iOS take them? Home is never bound. | Open. |
| Does the game reach 120 Hz on a Pro iPhone, and when does the governor drop to 60 in a 3-minute match? The app has no URL bar, so measure in Safari on the same phone with `?perf&match=180`: the overlay's `frame` line and its `rate` line (`uncapped` or `locked60`). | Open. |
| Does `toktx` install on the Mac? | Open (Stage 4b slice 5). |

One thing to know about 120 Hz: whether WKWebView's `requestAnimationFrame` runs at 120 Hz inside
an app also depends on iOS. If the perf overlay's frame time never drops below 16.7 ms on a Pro
iPhone, the web view is held to 60 whatever the plist says, and the governor has nothing to do.
