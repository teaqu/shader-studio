import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each project runs its own pool, and the ones that set no cap default to
    // one worker per core. Twelve projects at once oversubscribed this machine
    // by roughly five times, which is what pushed multi-second imports and
    // sweeps past their timeouts; the cap keeps total workers near the core
    // count no matter how many projects are listed below.
    maxWorkers: 4,
    coverage: {
      // V8 precise profiling slows the exhaustive Slang sweep enough to exceed its
      // unchanged timeout. Istanbul limits instrumentation to our source scope.
      // Restore Svelte's missing template mount mapping before instrumentation.
      provider: 'custom',
      customProviderModule: './.github/scripts/svelte-istanbul-provider.mjs',
      include: [
        'debug/src/**/*.ts', 'rendering/src/**/*.ts', 'ui/src/**/*.{ts,svelte}',
        'language-servers/*/src/**/*.ts', 'types/src/**/*.ts', 'utils/src/**/*.ts',
        'monaco/src/**/*.ts', 'standalone/src/**/*.{ts,svelte}', 'shader-explorer/src/**/*.{ts,svelte}',
      ],
      exclude: ['**/*.d.ts', '**/test/**', '**/tests/**', '**/*.test.*', '**/*.spec.*', '**/generated/**', 'ui/src/slang/**'],
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportOnFailure: true,
      // Package ratchets measured with the full unit suite (Istanbul).
      thresholds: {
        'debug/src/**': { statements: 90, branches: 82.5, functions: 96, lines: 89.5 },
        'rendering/src/**': { statements: 92, branches: 85.5, functions: 93, lines: 92 },
        'ui/src/**': { statements: 90, branches: 79.5, functions: 85.5, lines: 90.5 },
        'language-servers/core/src/**': { statements: 88, branches: 87.5, functions: 78.5, lines: 88 },
        'language-servers/glsl-analysis/src/**': { statements: 96, branches: 87, functions: 97, lines: 96 },
        'language-servers/glsl/src/**': { statements: 95, branches: 87, functions: 98, lines: 94.5 },
        'language-servers/slang/src/**': { statements: 90, branches: 80, functions: 92, lines: 90 },
        'language-servers/wgsl-analysis/src/**': { statements: 88.5, branches: 85, functions: 99, lines: 88.5 },
        'language-servers/wgsl/src/**': { statements: 97.5, branches: 91.5, functions: 98.5, lines: 97.5 },
      },
    },
    projects: [
      'types/vitest.config.ts',
      'standalone/vitest.config.ts',
      'ui/vitest.config.ts',
      'debug/vitest.config.ts',
      'language-servers/core/vitest.config.ts',
      'language-servers/glsl-analysis/vitest.config.ts',
      'language-servers/glsl/vitest.config.ts',
      'language-servers/slang/vitest.config.ts',
      'language-servers/wgsl-analysis/vitest.config.ts',
      'language-servers/wgsl/vitest.config.ts',
      'rendering/vitest.config.ts',
      'utils/vitest.config.ts',
      'shader-explorer/vitest.config.ts',
      'monaco/vitest.config.ts',
    ],
  },
});
