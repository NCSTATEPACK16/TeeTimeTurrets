import { defineConfig } from "vite";
import { resolve } from "node:path";

/**
 * Builds the Scene Gate harness page. Separate from the app build for the same reason
 * tools/probe.vite.config.ts is: the gate has its own entry point and its own output, and the
 * game bundle must not carry either.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, "gate"),
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, ".gate-dist"),
    emptyOutDir: true,
    minify: false,
  },
});
