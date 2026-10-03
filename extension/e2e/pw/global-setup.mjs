import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installProductionVsix } from './vsix-launch.mjs';
import { recordE2ePhase } from './e2e-timing.mjs';

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function ensureE2eRunId(environment = process.env, createId = randomUUID) {
  if (!environment.GITHUB_RUN_ID && !environment.SHADER_STUDIO_E2E_RUN_ID) {
    environment.SHADER_STUDIO_E2E_RUN_ID = `local-${createId()}`;
  }
  return environment.GITHUB_RUN_ID ?? environment.SHADER_STUDIO_E2E_RUN_ID;
}

/**
 * Ensure the pinned VS Code exists before any worker starts.
 *
 * Each spec file runs in its own worker (see `vscodeKey`), so doing this in the
 * fixture means every worker races to populate the same cache directory on a
 * cold checkout. Downloading once here keeps workers to a fast path lookup.
 */
export default async function globalSetup() {
  ensureE2eRunId();
  const setupStartedAt = performance.now();
  const version = process.env.SHADER_STUDIO_E2E_VSCODE_VERSION ?? '1.109.5';
  const vscodeStartedAt = performance.now();
  const executable = await downloadAndUnzipVSCode({
    version,
    cachePath: join(extensionPath, '.vscode-test'),
  });
  recordE2ePhase('vscode-cache', vscodeStartedAt);
  process.env.SHADER_STUDIO_PW_VSCODE_BIN = executable;

  const vsixPath = process.env.SHADER_STUDIO_E2E_PRODUCTION_VSIX ?? process.env.SHADER_STUDIO_E2E_VSIX;
  let seedProfile;
  if (vsixPath) {
    const seedStartedAt = performance.now();
    seedProfile = mkdtempSync(join(tmpdir(), 'ss-vsix-seed-'));
    const seedExtensionsDir = join(seedProfile, 'extensions');
    installProductionVsix({
      vscodeBinary: executable,
      vsixPath,
      userDataDir: seedProfile,
      extensionsDir: seedExtensionsDir,
    });
    process.env.SHADER_STUDIO_E2E_VSIX_SEED = seedExtensionsDir;
    recordE2ePhase('vsix-seed', seedStartedAt);
  }
  recordE2ePhase('global-setup', setupStartedAt);
  return () => {
    const teardownStartedAt = performance.now();
    if (seedProfile) {
      rmSync(seedProfile, { recursive: true, force: true });
    }
    recordE2ePhase('global-teardown', teardownStartedAt);
  };
}
