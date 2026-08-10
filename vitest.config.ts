import { defineConfig } from 'vitest/config';

// KLYN AI OS — Vitest configuration.
// Excludes historical archives (genesis bootstrap history, ESM migration
// backups, compiled output) so `npm run test:integration` only ever runs the
// live kernel test suite.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.migration-backup/**',
      '**/genesis/**',
      '**/dist/**',
      '**/build/**',
    ],
  },
});
