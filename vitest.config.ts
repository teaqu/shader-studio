import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'ui/vitest.config.ts',
      'debug/vitest.config.ts',
      'rendering/vitest.config.ts',
      'utils/vitest.config.ts',
      'shader-explorer/vitest.config.ts',
      'snippet-library/vitest.config.ts',
      'monaco/vitest.config.ts',
    ],
  },
});
