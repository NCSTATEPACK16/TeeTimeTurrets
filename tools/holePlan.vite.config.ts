import { defineConfig } from "vite";

/** Bundles tools/holePlan.ts into a Node-runnable ESM file so the DOM-free sim can be drawn headlessly. */
export default defineConfig({
  build: {
    ssr: "tools/holePlan.ts",
    outDir: "tools/.plan-out",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "holePlan.mjs" } },
  },
});
