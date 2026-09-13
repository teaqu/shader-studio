import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ExecFileSyncOptions } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getSlangWasmPath,
  ensureSlangWasm,
  SLANG_ARCHIVE_SHA256,
  SLANG_ARCHIVE_URL,
  SLANG_VERSION,
  SLANG_WASM_SHA256,
} from '../../scripts/ensure-slang-wasm.mjs';

const digestOf = (content: string) => createHash('sha256').update(content).digest('hex');

/** Stand in for the release archive: curl writes it, unzip unpacks the binary. */
function fakeRelease(archive: string, wasm: string) {
  const commands: string[] = [];
  const runCommand = (command: string, args: readonly string[]) => {
    commands.push(command);
    if (command === 'curl') {
      writeFileSync(args[args.indexOf('-o') + 1]!, archive);
    }
    if (command === 'unzip') {
      writeFileSync(join(args[args.indexOf('-d') + 1]!, 'slang-wasm.wasm'), wasm);
    }
    return Buffer.alloc(0);
  };
  return {
    commands,
    runCommand,
    expected: { archive: digestOf(archive), wasm: digestOf(wasm) },
  };
}

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

  it('returns without downloading when the asset already exists and matches', () => {
    const root = createTemporaryRoot();
    const wasmPath = getSlangWasmPath(root);
    mkdirSync(join(root, 'src', 'slang'), { recursive: true });
    writeFileSync(wasmPath, 'test wasm');

    const expected = { archive: digestOf('unused'), wasm: digestOf('test wasm') };
    expect(ensureSlangWasm(root, undefined, expected)).toEqual({ downloaded: false, wasmPath });
  });

  it('downloads, extracts, and copies a missing asset', () => {
    const root = createTemporaryRoot();
    const release = fakeRelease('archive bytes', 'downloaded wasm');

    const result = ensureSlangWasm(root, release.runCommand, release.expected);

    expect(result).toEqual({ downloaded: true, wasmPath: getSlangWasmPath(root) });
    expect(release.commands).toEqual(['curl', 'unzip']);
    expect(readFileSync(result.wasmPath, 'utf8')).toBe('downloaded wasm');
  });

  it('pins the digests of the archive and the binary it ships', () => {
    expect(SLANG_ARCHIVE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(SLANG_WASM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses an archive that does not match its digest', () => {
    const root = createTemporaryRoot();
    const release = fakeRelease('tampered archive', 'downloaded wasm');

    expect(() => ensureSlangWasm(root, release.runCommand, {
      ...release.expected,
      archive: digestOf('the pinned archive'),
    })).toThrow(/archive does not match its pinned digest/);
    expect(release.commands).toEqual(['curl']);
    expect(existsSync(getSlangWasmPath(root))).toBe(false);
  });

  it('refuses a binary that does not match its digest', () => {
    const root = createTemporaryRoot();
    const release = fakeRelease('archive bytes', 'tampered wasm');

    expect(() => ensureSlangWasm(root, release.runCommand, {
      ...release.expected,
      wasm: digestOf('the pinned wasm'),
    })).toThrow(/WASM binary does not match its pinned digest/);
    expect(existsSync(getSlangWasmPath(root))).toBe(false);
  });

  it('replaces a kept file that no longer matches, such as a truncated download', () => {
    const root = createTemporaryRoot();
    mkdirSync(join(root, 'src', 'slang'), { recursive: true });
    writeFileSync(getSlangWasmPath(root), 'half a download');
    const release = fakeRelease('archive bytes', 'downloaded wasm');

    const result = ensureSlangWasm(root, release.runCommand, release.expected);

    expect(result.downloaded).toBe(true);
    expect(readFileSync(result.wasmPath, 'utf8')).toBe('downloaded wasm');
  });

  it('reports an archive that does not contain the WASM asset', () => {
    const root = createTemporaryRoot();
    // A well-formed archive that unpacks to nothing: the digest is right, the
    // contents are not what the build needs.
    const runCommand = (command: string, args: readonly string[]) => {
      if (command === 'curl') {
        writeFileSync(args[args.indexOf('-o') + 1]!, 'archive bytes');
      }
      return Buffer.alloc(0);
    };

    expect(() => ensureSlangWasm(root, runCommand, {
      archive: digestOf('archive bytes'),
      wasm: digestOf('unused'),
    })).toThrow('The Slang archive did not contain slang-wasm.wasm.');
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
