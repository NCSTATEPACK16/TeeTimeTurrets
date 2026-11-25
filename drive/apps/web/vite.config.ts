import { defineConfig } from 'vite';

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
  server: { port: 5173 },
  preview: { port: 4173 },
});
