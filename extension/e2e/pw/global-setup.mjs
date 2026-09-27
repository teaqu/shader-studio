import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installProductionVsix } from './vsix-launch.mjs';

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

  const vsixPath = process.env.SHADER_STUDIO_E2E_PRODUCTION_VSIX ?? process.env.SHADER_STUDIO_E2E_VSIX;
  let seedProfile;
  if (vsixPath) {
    seedProfile = mkdtempSync(join(tmpdir(), 'ss-vsix-seed-'));
    const seedExtensionsDir = join(seedProfile, 'extensions');
    installProductionVsix({
      vscodeBinary: executable,
      vsixPath,
      userDataDir: seedProfile,
      extensionsDir: seedExtensionsDir,
    });
    process.env.SHADER_STUDIO_E2E_VSIX_SEED = seedExtensionsDir;
  }
  return () => {
    if (seedProfile) {
      rmSync(seedProfile, { recursive: true, force: true });
    }
  };
}
