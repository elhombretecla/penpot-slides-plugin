import { defineConfig } from 'vitest/config';

// Unit tests run in Node on the pure modules (geometry, render keys / plan,
// SVG and markup helpers, deck format, store). UI flows are covered by the
// browser suite in e2e/.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
