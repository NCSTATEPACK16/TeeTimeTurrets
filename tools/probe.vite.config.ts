import { defineConfig } from "vite";

/** Bundles tools/feelProbe.ts into a Node-runnable ESM file so the DOM-free sim can be measured headlessly. */
export default defineConfig({
  build: {
    ssr: "tools/feelProbe.ts",
    outDir: "tools/.probe-out",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "feelProbe.mjs" } },
  },
});
