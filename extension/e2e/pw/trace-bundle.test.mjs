import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

test('the GPU trace webview bundles without Node-only utilities', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../../rendering/src/trace/WgslTraceWebview.ts', import.meta.url))],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  assert.ok(result.outputFiles[0].text.length > 0);
  assert.ok(!Object.keys(result.metafile.inputs).some(input => input.includes('slang-dependency-graph')));
});
