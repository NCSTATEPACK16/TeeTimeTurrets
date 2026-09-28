import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  server: { port: 5173 },
  optimizeDeps: {
    exclude: ["@dimforge/rapier3d-compat"],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Rapier ships its WASM inline as base64, and it is most of the download. Its own chunk,
            // reached only through the match path's dynamic import (src/app/matchPath.ts), so the
            // title never waits for it and a code change elsewhere does not invalidate its cache.
            { name: "rapier", test: /node_modules[\\/]@dimforge[\\/]rapier3d-compat/, priority: 20 },
            // three's core build, shared by every screen, changes only on an upgrade. Its `examples/`
            // addons stay with whatever imports them, so a lazily loaded one (GLTFLoader) stays lazy.
            { name: "three", test: /node_modules[\\/]three[\\/]build[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
