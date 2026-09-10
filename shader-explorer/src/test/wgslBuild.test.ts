// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { build } from 'vite';
import path from 'node:path';

describe('explorer WGSL dependency bundling', () => {
  it('bundles the compute prelude using the explorer production configuration', async () => {
    const result = await build({
      configFile: path.resolve(__dirname, '../../vite.config.ts'),
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.resolve(__dirname, '../../../rendering/src/webgpu/WgslPrelude.ts'),
          formats: ['es'],
        },
      },
    });
    const bundles = Array.isArray(result) ? result : [result];
    expect(bundles.some(bundle => 'output' in bundle && bundle.output.some(chunk =>
      chunk.type === 'chunk' && chunk.code.includes('getWgslComputeEntryPoints'),
    ))).toBe(true);
  });
});
