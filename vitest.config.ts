import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@signalglass/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@signalglass/parsers': path.resolve(__dirname, 'packages/parsers/src/index.ts'),
      '@signalglass/reports': path.resolve(__dirname, 'packages/reports/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
  },
});
