import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ExecFileSyncOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getSlangWasmPath, ensureSlangWasm, SLANG_ARCHIVE_URL, SLANG_VERSION } from '../../scripts/ensure-slang-wasm.mjs';

const temporaryRoots: string[] = [];

function createTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'shader-studio-slang-test-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ensureSlangWasm', () => {
  it('uses the pinned Slang release', () => {
    expect(SLANG_ARCHIVE_URL).toContain(`v${SLANG_VERSION}/slang-${SLANG_VERSION}-wasm.zip`);
  });

  it('returns without downloading when the asset already exists', () => {
    const root = createTemporaryRoot();
    const wasmPath = getSlangWasmPath(root);
    mkdirSync(join(root, 'src', 'slang'), { recursive: true });
    writeFileSync(wasmPath, 'test wasm');

    expect(ensureSlangWasm(root)).toEqual({ downloaded: false, wasmPath });
  });

  it('downloads, extracts, and copies a missing asset', () => {
    const root = createTemporaryRoot();
    const commands: string[] = [];
    const runCommand = (command: string, args: readonly string[], _options: ExecFileSyncOptions) => {
      commands.push(command);
      if (command === 'unzip') {
        const extractionRoot = args[args.indexOf('-d') + 1];
        writeFileSync(join(extractionRoot, 'slang-wasm.wasm'), 'downloaded wasm');
      }
      return Buffer.alloc(0);
    };

    const result = ensureSlangWasm(root, runCommand);

    expect(result).toEqual({ downloaded: true, wasmPath: getSlangWasmPath(root) });
    expect(commands).toEqual(['curl', 'unzip']);
    expect(readFileSync(result.wasmPath, 'utf8')).toBe('downloaded wasm');
  });

  it('reports an archive that does not contain the WASM asset', () => {
    const root = createTemporaryRoot();

    expect(() => ensureSlangWasm(root, () => Buffer.alloc(0))).toThrow(
      'The Slang archive did not contain slang-wasm.wasm.',
    );
    expect(existsSync(getSlangWasmPath(root))).toBe(false);
  });

  it('reports download command failures', () => {
    const root = createTemporaryRoot();

    expect(() => ensureSlangWasm(root, () => {
      throw new Error('network unavailable');
    })).toThrow('Unable to prepare Slang WASM. Install curl and unzip');
    expect(existsSync(getSlangWasmPath(root))).toBe(false);
  });
});
