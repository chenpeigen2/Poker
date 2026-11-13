import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@poker/domain': resolvePath('./packages/domain/src/index.ts'),
      '@poker/engine': resolvePath('./packages/engine/src/index.ts'),
      '@poker/ai': resolvePath('./packages/ai/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
  },
});
