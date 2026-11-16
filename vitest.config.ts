import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@verdictagent/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/score/**', 'packages/mcp-server/src/mcp/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
      reporter: ['text', 'json-summary'],
    },
  },
});
