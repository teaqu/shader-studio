import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SLANG_VERSION = '2026.10.2';
export const SLANG_ARCHIVE_URL =
  `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-wasm.zip`;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** @typedef {(command: string, args: readonly string[], options: import('node:child_process').ExecFileSyncOptions) => unknown} RunCommand */

export function getSlangWasmPath(uiRoot = resolve(scriptDirectory, '..')) {
  return join(uiRoot, 'src', 'slang', 'slang-wasm.wasm');
}

/**
 * @param {string} [uiRoot]
 * @param {RunCommand} [runCommand]
 */
export function ensureSlangWasm(uiRoot = resolve(scriptDirectory, '..'), runCommand = execFileSync) {
  const wasmPath = getSlangWasmPath(uiRoot);
  if (existsSync(wasmPath)) {
    return { downloaded: false, wasmPath };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'shader-studio-slang-'));
  const archivePath = join(tempRoot, 'slang-wasm.zip');
  const extractionRoot = join(tempRoot, 'extracted');

  try {
    mkdirSync(extractionRoot);
    runCommand('curl', ['-fL', '--retry', '3', SLANG_ARCHIVE_URL, '-o', archivePath], {
      stdio: 'inherit',
    });
    runCommand('unzip', ['-j', archivePath, '*slang-wasm.wasm', '-d', extractionRoot], {
      stdio: 'inherit',
    });

    const extractedPath = join(extractionRoot, 'slang-wasm.wasm');
    if (!existsSync(extractedPath)) {
      throw new Error('The Slang archive did not contain slang-wasm.wasm.');
    }

    mkdirSync(join(uiRoot, 'src', 'slang'), { recursive: true });
    copyFileSync(extractedPath, wasmPath);
    return { downloaded: true, wasmPath };
  } catch (error) {
    throw new Error(
      `Unable to prepare Slang WASM. Install curl and unzip, then see ui/src/slang/.gitignore for manual setup. ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = ensureSlangWasm();
  if (result.downloaded) {
    console.log(`Downloaded Slang WASM to ${result.wasmPath}`);
  }
}
