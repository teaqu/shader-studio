import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';

let parserModule: string;
beforeAll(async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../parseWgslDocument.ts', import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs' });
  parserModule = result.outputFiles[0].text;
});

// Malformed input used to loop synchronously until the editor exhausted memory.
// Run the real parser in a bounded worker so this regression can fail safely.
it.each(['}', 'fn broken(}', 'fn broken(value: }', 'fn broken(value: f32 }', 'fn broken() { let x = vec4f( }', 'fn broken() { foo( }'])('recovers from %s and retains subsequent declarations', async malformed => {
  const source = `${malformed}\nfn following() -> f32 { return 0.375; }`;
  const worker = new Worker(`${parserModule}\nconst { parentPort, workerData } = require('node:worker_threads');\nconst result = module.exports.parseWgslDocument('/broken.wgsl', workerData, 'fragment');\nparentPort.postMessage({ diagnostics: result.diagnostics, names: result.symbols.map(symbol => symbol.name) });`, { eval: true, workerData: source, resourceLimits: { maxOldGenerationSizeMb: 64 } });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<{ diagnostics: unknown[]; names: string[] }>((resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('WGSL parser failed to make progress on malformed input')), 2000);
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.names).toContain('following');
  } finally {
    clearTimeout(deadline);
    await worker.terminate();
  }
});
