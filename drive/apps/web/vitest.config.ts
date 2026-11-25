import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Gate tests print their measurements (max parity error, speeds, roll); keep that output.
    silent: false,
    testTimeout: 120_000,
  },
});
