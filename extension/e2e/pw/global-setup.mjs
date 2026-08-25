import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Ensure the pinned VS Code exists before any worker starts.
 *
 * Each spec file runs in its own worker (see `vscodeKey`), so doing this in the
 * fixture means every worker races to populate the same cache directory on a
 * cold checkout. Downloading once here keeps workers to a fast path lookup.
 */
export default async function globalSetup() {
  const version = process.env.SHADER_STUDIO_E2E_VSCODE_VERSION ?? '1.109.5';
  const executable = await downloadAndUnzipVSCode({
    version,
    cachePath: join(extensionPath, '.vscode-test'),
  });
  process.env.SHADER_STUDIO_PW_VSCODE_BIN = executable;
}
