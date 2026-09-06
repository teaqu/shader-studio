import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each project runs its own pool, and the ones that set no cap default to
    // one worker per core. Twelve projects at once oversubscribed this machine
    // by roughly five times, which is what pushed multi-second imports and
    // sweeps past their timeouts; the cap keeps total workers near the core
    // count no matter how many projects are listed below.
    maxWorkers: 4,
    projects: [
      'types/vitest.config.ts',
      'standalone/vitest.config.ts',
      'ui/vitest.config.ts',
      'debug/vitest.config.ts',
      'language-servers/core/vitest.config.ts',
      'language-servers/glsl-analysis/vitest.config.ts',
      'language-servers/glsl/vitest.config.ts',
      'language-servers/slang/vitest.config.ts',
      'rendering/vitest.config.ts',
      'utils/vitest.config.ts',
      'shader-explorer/vitest.config.ts',
      'monaco/vitest.config.ts',
    ],
  },
});
