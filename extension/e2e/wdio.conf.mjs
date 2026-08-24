import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionPath = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWorkspacePath = join(extensionPath, 'e2e', 'fixtures', 'slang-parity-validation');
const workspacePath = resolve(process.env.SHADER_STUDIO_E2E_WORKSPACE ?? defaultWorkspacePath);
const outputDir = join(extensionPath, '.wdio');

// The extension development host exports this for its own child processes. If
// inherited here, the VS Code Electron binary starts as plain Node and rejects
// every WebDriver browser flag before a test session can be created.
delete process.env.ELECTRON_RUN_AS_NODE;

process.env.SHADER_STUDIO_E2E_WORKSPACE = workspacePath;

// wdio-vscode-service starts VS Code through a wrapper that shells out with
// child_process.execFile, which caps the child's stderr at Node's default 1 MiB
// maxBuffer. On overflow Node SIGTERMs VS Code mid-run. Electron then shuts down
// gracefully, so there is no crash report, no crash dump and no error in any
// log — the run just reports "invalid session id: session deleted as the
// browser has closed the connection". This scan turns that silent kill into a
// named diagnosis.
// Driver logs from earlier runs linger in the output directory; only this
// run's logs say anything about this run's stderr budget.
const runStartedAt = Date.now();
const CHILD_STDERR_LIMIT = 1024 * 1024;
const CHILD_STDERR_WARN_RATIO = 0.6;
const WRAPPER_PREFIX = '[FAKE VSCode Binary]';
const WRAPPER_STDERR_PREFIX = `${WRAPPER_PREFIX} STDERR: `;

/** Bytes of VS Code stderr the launcher wrapper forwarded into a driver log. */
function forwardedStderrBytes(logPath) {
  let total = 0;
  let inStderrChunk = false;
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.startsWith(WRAPPER_STDERR_PREFIX)) {
      total += Buffer.byteLength(line) - WRAPPER_STDERR_PREFIX.length + 1;
      inStderrChunk = true;
    } else if (line.startsWith(WRAPPER_PREFIX)) {
      inStderrChunk = false;
    } else if (inStderrChunk) {
      // Continuation lines of a multi-line stderr chunk carry no prefix.
      total += Buffer.byteLength(line) + 1;
    }
  }
  return total;
}

function reportStderrBudget() {
  let logs;
  try {
    logs = readdirSync(outputDir).filter((name) => name.endsWith('-chromedriver.log'));
  } catch {
    console.log(`[stderr budget] no driver logs under ${outputDir} to measure`);
    return;
  }
  const measured = [];
  for (const name of logs) {
    let bytes;
    try {
      if (statSync(join(outputDir, name)).mtimeMs < runStartedAt) {
        continue;
      }
      bytes = forwardedStderrBytes(join(outputDir, name));
    } catch {
      continue;
    }
    measured.push({ name, bytes });
  }
  // Always report, even when healthy. A check that only speaks up on trouble
  // cannot be told apart from one that is not running at all.
  if (measured.length === 0) {
    console.log('[stderr budget] no driver log from this run was measured');
  } else {
    const summary = measured
      .map(({ name, bytes }) => `${name} ${Math.round(bytes / 1024)} KiB `
        + `(${Math.round((bytes / CHILD_STDERR_LIMIT) * 100)}% of cap)`)
      .join(', ');
    console.log(`[stderr budget] ${summary}`);
  }
  for (const { name, bytes } of measured) {
    if (bytes < CHILD_STDERR_LIMIT * CHILD_STDERR_WARN_RATIO) {
      continue;
    }
    const used = `${Math.round(bytes / 1024)} KiB of ${CHILD_STDERR_LIMIT / 1024} KiB`;
    const banner = bytes >= CHILD_STDERR_LIMIT
      ? `VS Code stderr EXCEEDED the launcher wrapper's execFile maxBuffer (${used}).`
      : `VS Code stderr is nearing the launcher wrapper's execFile maxBuffer (${used}).`;
    console.error([
      '',
      '='.repeat(78),
      banner,
      `  driver log: ${join(outputDir, name)}`,
      '  At the limit Node SIGTERMs VS Code mid-run. The session then dies with',
      '  "invalid session id: session deleted as the browser has closed the',
      '  connection" and leaves no crash report - it is not a renderer crash.',
      '  Fix by reducing VS Code console output, not by retrying: keep',
      '  wdio:vscodeOptions.verboseLogging false (it adds --verbose and',
      '  --log-extension-host-communication) and check for chatty new logging.',
      '='.repeat(78),
      '',
    ].join('\n'));
  }
}

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
        // The webview drives variable capture from requestAnimationFrame, and
        // rAF does not fire while a document is hidden. Chromium marks a window
        // hidden when the OS occludes it, so any window covering the test
        // window stalls the capture loop and makes dockview measure 0 (which
        // collapses the toolbar behind its container queries). Neither has
        // anything to do with the behaviour under test.
        'disable-backgrounding-occluded-windows': true,
        'disable-renderer-backgrounding': true,
        'disable-background-timer-throttling': true,
      },
      // Must stay false. wdio-vscode-service launches VS Code through a
      // wrapper that uses child_process.execFile with Node's default 1 MiB
      // maxBuffer. verboseLogging adds --verbose --log-extension-host-
      // communication, which pushes VS Code's stderr past 1 MiB partway
      // through a long spec; Node then SIGTERMs VS Code, Electron shuts down
      // gracefully, and WebDriver reports "session deleted as the browser has
      // closed the connection" with no crash report. VS Code still writes its
      // trace logs to <user-data-dir>/logs for post-mortem analysis.
      verboseLogging: false,
      vscodeProxyOptions: {
        enable: true,
        connectionTimeout: 30_000,
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
  onComplete: () => {
    reportStderrBudget();
  },
};
