import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'types/vitest.config.ts',
      'ui/vitest.config.ts',
      'debug/vitest.config.ts',
      'language-servers/core/vitest.config.ts',
      'language-servers/glsl-analysis/vitest.config.ts',
      'rendering/vitest.config.ts',
      'utils/vitest.config.ts',
      'shader-explorer/vitest.config.ts',
      'monaco/vitest.config.ts',
    ],
  },
});
