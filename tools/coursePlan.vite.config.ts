import { defineConfig } from "vite";

/** Bundles tools/coursePlan.ts into a Node-runnable ESM file, as holePlan.vite.config.ts does. */
export default defineConfig({
  build: {
    ssr: "tools/coursePlan.ts",
    outDir: "tools/.course-out",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { entryFileNames: "coursePlan.mjs" } },
  },
});
