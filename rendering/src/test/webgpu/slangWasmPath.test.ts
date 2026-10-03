import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { slangWasmPath } from './slangWasmPath';

describe('Node Slang WASM filename', () => {
  it('decodes spaces and preserves a native Windows drive or POSIX root', () => {
    const directory = resolve('checkout with spaces', 'rendering/src/test/webgpu');
    expect(slangWasmPath(pathToFileURL(resolve(directory, 'helper.ts')).href))
      .toBe(resolve(directory, '../../../../ui/src/slang/slang-wasm.wasm'));
  });
  it('rejects a browser URL instead of treating it as a local filename', () => {
    expect(() => slangWasmPath('https://localhost/rendering/test.ts')).toThrow();
  });
});
