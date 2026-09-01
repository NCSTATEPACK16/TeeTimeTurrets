import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { port: 5173 },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
});
