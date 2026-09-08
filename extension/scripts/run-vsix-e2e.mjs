import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVsix } from './verify-vsix.mjs';

/**
 * Drives the packaged artifact rather than the source tree. The development
 * host resolves every import through the repo's node_modules, so it proves
 * nothing about a VSIX packaged with `--no-dependencies`: 1.1.0 passed the
 * whole E2E suite while shipping a script bundler that could not load its
 * engine. This packages, checks the archive, then runs the GPU-free specs
 * against the installed extension.
 */
const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const provided = process.env.SHADER_STUDIO_E2E_VSIX;
  const workDir = provided ? null : mkdtempSync(join(tmpdir(), 'ss-vsix-e2e-'));
  const vsixPath = provided
    ? resolve(provided)
    : join(workDir, 'shader-studio-e2e.vsix');

  try {
    if (!provided) {
      execFileSync('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '--out', vsixPath], {
        cwd: extensionRoot,
        stdio: 'inherit',
      });
    }
    if (!existsSync(vsixPath)) {
      throw new Error(`no VSIX at ${vsixPath}`);
    }

    const problems = await checkVsix(vsixPath);
    if (problems.length > 0) {
      console.error('the packaged VSIX is missing what it needs at runtime:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exit(1);
    }

    execFileSync('npx', ['playwright', 'test', '--config', './e2e/pw/playwright.config.mjs'], {
      cwd: extensionRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        SHADER_STUDIO_E2E_VSIX: vsixPath,
        SHADER_STUDIO_E2E_GREP_INVERT: process.env.SHADER_STUDIO_E2E_GREP_INVERT ?? '@gpu',
      },
    });
  } finally {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

await main();
