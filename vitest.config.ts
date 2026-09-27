import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: the app build should not depend on vitest being
 * installed, and the test run does not need the browser-facing optimizeDeps rapier exclusion.
 *
 * `environment: "node"` is not merely a default -- it is the AGENTS.md invariant made
 * executable. Tests for src/sim/** and src/physics/** run with no DOM at all, so a stray
 * `window`/`document`/`three` import into either directory fails the suite rather than
 * silently working because a jsdom shim happened to be present.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tools/**/*.test.mjs"],
    // The 5 s default is shorter than one scripted arena match: `arenaGolden.test.ts` plays one in
    // about 9 s and its replay check plays two in about 18 s. CI runs a bare `vitest run`, so the
    // budget has to live here rather than in a `--testTimeout` flag somebody has to remember.
    testTimeout: 30_000,
  },
});
