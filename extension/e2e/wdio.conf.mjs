import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWorkspacePath = join(extensionPath, 'e2e', 'fixtures', 'slang-parity-validation');
const workspacePath = resolve(process.env.SHADER_STUDIO_E2E_WORKSPACE ?? defaultWorkspacePath);
const outputDir = join(extensionPath, '.wdio');

process.env.SHADER_STUDIO_E2E_WORKSPACE = workspacePath;

export const config = {
  runner: 'local',
  specs: [join(extensionPath, 'e2e', 'specs', '**', '*.e2e.mjs')],
  maxInstances: 1,
  logLevel: 'info',
  outputDir,
  bail: 0,
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120_000,
    ...(process.env.SHADER_STUDIO_E2E_GREP ? { grep: process.env.SHADER_STUDIO_E2E_GREP } : {}),
  },
  capabilities: [{
    browserName: 'vscode',
    browserVersion: process.env.SHADER_STUDIO_E2E_VSCODE_VERSION ?? '1.109.5',
    'wdio:enforceWebDriverClassic': true,
    'wdio:vscodeOptions': {
      extensionPath,
      workspacePath,
      filePath: join(workspacePath, 'validation.slang'),
      userSettings: {
        'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'workbench.startupEditor': 'none',
        'window.commandCenter': false,
        'extensions.ignoreRecommendations': true,
        'git.openRepositoryInParentFolders': 'never',
      },
      vscodeArgs: {
        'disable-workspace-trust': true,
        'enable-unsafe-webgpu': true,
        'skip-welcome': true,
      },
      verboseLogging: true,
      vscodeProxyOptions: {
        enable: true,
        connectionTimeout: 15_000,
        commandTimeout: 30_000,
      },
    },
  }],
  services: [['vscode', { cachePath: join(extensionPath, '.vscode-test') }]],
  afterTest: async (test, _context, { error }) => {
    if (!error) {
      return;
    }
    mkdirSync(outputDir, { recursive: true });
    const name = test.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    try {
      await browser.saveScreenshot(join(outputDir, `${name || 'failure'}.png`));
    } catch {
      // The extension host can replace its webview while reporting a failure.
    }
  },
};
