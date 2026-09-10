import { defineConfig } from "vite";

/** Bundles tools/terrainProbe.ts into a Node-runnable ESM file, as probe.vite.config.ts does. */
export default defineConfig({
  build: {
    ssr: "tools/terrainProbe.ts",
    outDir: "tools/.terrain-out",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "terrainProbe.mjs" } },
  },
});
