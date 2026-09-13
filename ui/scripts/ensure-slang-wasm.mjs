import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SLANG_VERSION = '2026.10.2';
export const SLANG_ARCHIVE_URL =
  `https://github.com/shader-slang/slang/releases/download/v${SLANG_VERSION}/slang-${SLANG_VERSION}-wasm.zip`;
/**
 * The binary is 21MB of the published extension and never passes through Git,
 * so the digest is what stands between a release and whatever the network
 * returned. Both are checked: the archive as downloaded, and the file that is
 * kept, which also catches a truncated or half-written copy from an earlier run.
 */
export const SLANG_ARCHIVE_SHA256 = 'bff18e4a0a0f1d377d4f8ac8bc0e9c631351f2e223a0482a279c1742f3d5bcc6';
export const SLANG_WASM_SHA256 = 'd5cec72503ae7ba7121c152297ec1bb9cbe98e2840433a1422f58f0fee283462';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

/** @typedef {(command: string, args: readonly string[], options: import('node:child_process').ExecFileSyncOptions) => unknown} RunCommand */
/** @typedef {{ archive: string, wasm: string }} ExpectedDigests */

/** @param {string} filePath */
function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/**
 * @param {string} filePath
 * @param {string} expected
 * @param {string} label
 */
function verifyDigest(filePath, expected, label) {
  const actual = sha256(filePath);
  if (actual !== expected) {
    throw new Error(`The Slang ${label} does not match its pinned digest. Expected ${expected}, got ${actual}.`);
  }
}

export function getSlangWasmPath(uiRoot = resolve(scriptDirectory, '..')) {
  return join(uiRoot, 'src', 'slang', 'slang-wasm.wasm');
}

/**
 * @param {string} [uiRoot]
 * @param {RunCommand} [runCommand]
 * @param {ExpectedDigests} [expected]
 */
export function ensureSlangWasm(
  uiRoot = resolve(scriptDirectory, '..'),
  runCommand = execFileSync,
  expected = { archive: SLANG_ARCHIVE_SHA256, wasm: SLANG_WASM_SHA256 },
) {
  const wasmPath = getSlangWasmPath(uiRoot);
  if (existsSync(wasmPath)) {
    // A file that fails the check is replaced rather than reported: the usual
    // cause is an interrupted download, and the fix is the download itself.
    if (sha256(wasmPath) === expected.wasm) {
      return { downloaded: false, wasmPath };
    }
  }

  const tempRoot = mkdtempSync(join(tmpdir(), 'shader-studio-slang-'));
  const archivePath = join(tempRoot, 'slang-wasm.zip');
  const extractionRoot = join(tempRoot, 'extracted');

  try {
    mkdirSync(extractionRoot);
    runCommand('curl', ['-fL', '--retry', '3', SLANG_ARCHIVE_URL, '-o', archivePath], {
      stdio: 'inherit',
    });
    verifyDigest(archivePath, expected.archive, 'archive');
    runCommand('unzip', ['-j', archivePath, '*slang-wasm.wasm', '-d', extractionRoot], {
      stdio: 'inherit',
    });

    const extractedPath = join(extractionRoot, 'slang-wasm.wasm');
    if (!existsSync(extractedPath)) {
      throw new Error('The Slang archive did not contain slang-wasm.wasm.');
    }
    verifyDigest(extractedPath, expected.wasm, 'WASM binary');

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
