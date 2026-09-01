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
    include: ["src/**/*.test.ts"],
  },
});
