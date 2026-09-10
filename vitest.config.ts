import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      all: true,
      include: [
        'src/core/hash.ts',
        'src/core/merkle_dag.ts',
        'src/parser/**/*.ts',
        'src/graph/**/*.ts',
        'src/query/**/*.ts',
        'utils/**/*.ts',
      ],
    },
  },
});
