import { fileURLToPath } from 'node:url';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

export default defineConfig({
  // Served at the site root on its own, and at /drive/ inside TeeTimeTurrets (tools/buildDrive.mjs
  // sets DRIVE_BASE). Levels and assets load through import.meta.env.BASE_URL, so both work.
  base: process.env.DRIVE_BASE ?? '/',
  build: {
    target: 'es2022',
    // One ~5.4 MB bundle (about 2 MB gzipped): three's WebGPU build plus Rapier's compat
    // build, which inlines its WASM as base64. Well inside the 60 MB first-download budget.
    chunkSizeWarningLimit: 6144,
  },
  server: {
    port: 5173,
    // The dev server only serves files under drive/ (the pnpm workspace root) unless told otherwise.
    // Shared art lives at the TeeTimeTurrets root, outside it: the Tee Time Links logo is imported
    // from art/brand/, the graphs from src/entities/graphs/ and the paint table from src/render/, so both apps use the one
    // file. Builds are unaffected; this is dev only.
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        fileURLToPath(new URL('../../../art/brand', import.meta.url)),
        fileURLToPath(new URL('../../../src/entities/graphs', import.meta.url)),
        // The paint table (pure data) that Choose Your Ride also reads.
        fileURLToPath(new URL('../../../src/render/teamColors.ts', import.meta.url)),
      ],
    },
  },
  preview: { port: 4173 },
});
