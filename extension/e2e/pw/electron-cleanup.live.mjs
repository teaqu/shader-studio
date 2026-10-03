/**
 * Opt-in live regression for #297.  This is deliberately outside the normal
 * node-test glob: it downloads (or reuses) the pinned VS Code Electron and
 * briefly opens a real workbench.
 *
 * Run: node --test extension/e2e/pw/electron-cleanup.live.mjs
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { randomBytes } from 'node:crypto';
import { cleanupFixture, attachCleanupFailure } from './fixture-cleanup.mjs';
import { monitorProcessTree, readProcessTable } from './process-tree.mjs';
import { openWindowDisplay } from './private-display.mjs';
import { recordE2eSample, withE2ePhase } from './e2e-timing.mjs';
import globalSetup from './global-setup.mjs';
import { cloneProductionVsixSeed, productionVsixInstallEnv, productionVsixLaunchArgs } from './vsix-launch.mjs';
import { findShownAppFrame } from './shader-frame.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, '..', '..');
const workspacePath = join(extensionPath, 'e2e', 'fixtures', 'slang-parity-validation');
const shaderPath = join(workspacePath, 'open-config-shows-shader-a.glsl');
const version = process.env.SHADER_STUDIO_E2E_VSCODE_VERSION ?? '1.109.5';
let executablePath;
let cleanupSetup;

function cleanEnv(extra) {
  return { ...productionVsixInstallEnv(), ...extra };
}

before(async () => {
  assert.ok(process.platform === 'darwin' || process.platform === 'linux', 'live POSIX cleanup validation supports macOS and Linux');
  assert.ok(process.env.SHADER_STUDIO_E2E_VSIX || process.env.SHADER_STUDIO_E2E_PRODUCTION_VSIX,
    'Set SHADER_STUDIO_E2E_VSIX to the production archive used by the installed suite');
  assert.ok(existsSync(shaderPath), `cleanup shader fixture is missing: ${shaderPath}`);
  cleanupSetup = await globalSetup();
  executablePath = process.env.SHADER_STUDIO_PW_VSCODE_BIN;
  assert.ok(existsSync(executablePath), `pinned VS Code ${version} was not found at ${executablePath}`);
});

after(async () => {
  await cleanupSetup?.();
});

async function launchTrackedCode(scenario) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ss-electron-cleanup-live-'));
  const windowDisplay = await openWindowDisplay();
  let app;
  let processTree;
  try {
    mkdirSync(join(userDataDir, 'User'));
    writeFileSync(join(userDataDir, 'User', 'settings.json'), JSON.stringify({
      'security.workspace.trust.enabled': false,
      'telemetry.telemetryLevel': 'off',
      'workbench.startupEditor': 'none',
    }));
    const extensionsDir = join(userDataDir, 'extensions');
    cloneProductionVsixSeed({ seedExtensionsDir: process.env.SHADER_STUDIO_E2E_VSIX_SEED, extensionsDir });
    app = await electron.launch({
      executablePath,
      env: cleanEnv({
        ...windowDisplay.env,
        SHADER_STUDIO_PW_NODE_PATH: process.execPath,
        SHADER_STUDIO_PW_PORT_FILE: join(userDataDir, 'bridge-port'),
        SHADER_STUDIO_PW_BRIDGE_TOKEN: randomBytes(32).toString('base64url'),
        SHADER_STUDIO_E2E_WORKSPACE: workspacePath,
      }),
      args: productionVsixLaunchArgs({
        userDataDir, extensionsDir,
        bridgeExtensionPath: join(here, 'bridge-extension'), workspacePath,
      }),
      timeout: 120_000,
    });
    processTree = await monitorProcessTree(app.process().pid, {
      sample: details => recordE2eSample({ scenario, ...details }),
    });
    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForSelector('.monaco-workbench', { timeout: 60_000 });
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.keyboard.press(`${modifier}+P`);
    const input = window.locator('.quick-input-widget input');
    await input.fill(shaderPath);
    await window.locator('.quick-input-list .monaco-list-row').filter({ hasText: 'open-config-shows-shader-a.glsl' }).first().waitFor();
    await input.press('Enter');
    await window.locator('.monaco-editor:visible').first().waitFor();
    await window.keyboard.press(`${modifier}+Shift+P`);
    await input.fill('>Shader Studio: New Panel');
    await window.locator('.quick-input-list').getByText('Shader Studio: New Panel', { exact: true }).click();
    const deadline = Date.now() + 60_000;
    let shaderFrame;
    do {
      shaderFrame = await findShownAppFrame(window.frames());
      if (shaderFrame) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.ok(shaderFrame, 'the production extension must host a real webview before cleanup');
    await shaderFrame.waitForSelector('.canvas-container canvas');
    return { app, processTree, userDataDir, windowDisplay, scenario };
  } catch (error) {
    try {
      if (app) {
        await measuredCleanup({ app, processTree, processPid: app.process().pid, userDataDir, windowDisplay });
      } else {
        await windowDisplay.close();
      }
    } catch (cleanupError) {
      attachCleanupFailure(error, cleanupError);
    }
    // Launch/inventory failure does not establish process exit; retain any
    // profile the shared cleanup helper could not safely remove.
    throw error;
  }
}

function startUnrelatedControl() {
  return spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
}

async function spawnWedgedOwnedTree(app) {
  // These are born under VS Code's Electron main process. The supervisor and
  // child ignore TERM, which makes cleanup use its exact owned-PID fallback.
  // The supervisor reports the child PID so the test can prove both identities
  // were sampled before termination can reparent either process.
  return app.evaluate(() => new Promise((resolve, reject) => {
    const { spawn } = process.getBuiltinModule('node:child_process');
    const script = [
      "const {spawn}=require('node:child_process')",
      "process.on('SIGTERM',()=>{})",
      "const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'})",
      'console.log(child.pid)',
      'setInterval(()=>{},1000)',
    ].join(';');
    const supervisor = spawn(process.env.SHADER_STUDIO_PW_NODE_PATH, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    supervisor.stderr.on('data', chunk => {
      stderr += chunk;
    });
    supervisor.once('error', reject);
    supervisor.stdout.once('data', chunk => resolve({
      supervisorPid: supervisor.pid,
      childPid: Number(chunk.toString().trim()),
      stderr,
    }));
  }));
}


async function measuredCleanup(options) {
  const { scenario = 'launch-failure' } = options;
  const cpuStartedAt = process.cpuUsage();
  return withE2ePhase('controlled-cleanup', async () => {
    const result = await cleanupFixture({
      ...options,
      phase: details => {
        options.phase?.(details);
        recordE2eSample({ scenario, ...details });
      },
    });
    const cpu = process.cpuUsage(cpuStartedAt);
    recordE2eSample({
      phase: 'controlled-cleanup-exit', scenario,
      harnessCpuSeconds: (cpu.user + cpu.system) / 1_000_000,
      ...result,
    });
    return result;
  }, { scenario });
}

async function recoverFixture(fixture) {
  if (!fixture || !existsSync(fixture.userDataDir)) {
    return;
  }
  try {
    await measuredCleanup({ ...fixture, processPid: fixture.app.process().pid });
  } catch (error) {
    // Retain the profile and make failed diagnostic-resource recovery visible.
    console.error(`Controlled cleanup could not verify exit; profile ${fixture.userDataDir}: ${error.message}`);
  }
}

test('pinned Electron closes gracefully before profile and display removal', { timeout: 180_000 }, async () => {
  const fixture = await launchTrackedCode('normal');
  let displayClosed = false;
  const windowDisplay = {
    ...fixture.windowDisplay,
    close: async () => {
      displayClosed = true;
      await fixture.windowDisplay.close();
    },
  };
  try {
    const result = await measuredCleanup({ ...fixture, processPid: fixture.app.process().pid, windowDisplay });
    assert.equal(result.graceful, true);
    assert.equal(result.forced, false);
    assert.equal(existsSync(fixture.userDataDir), false);
    assert.equal(displayClosed, true);
  } finally {
    await recoverFixture(fixture);
    await fixture.processTree.stop().catch(() => {});
  }
});

test('pinned Electron controlled wedge escalates only exact owned births', { timeout: 180_000 }, async () => {
  const fixture = await launchTrackedCode('controlled-wedge');
  const unrelated = startUnrelatedControl();
  let owned;
  try {
    const wedge = await spawnWedgedOwnedTree(fixture.app);
    await fixture.processTree.inspect();
    owned = await fixture.processTree.inspect();
    const wedgedRows = owned.filter(row => [wedge.supervisorPid, wedge.childPid].includes(row.pid));
    assert.equal(wedgedRows.length, 2, `owned children were not both sampled: ${JSON.stringify(owned)}`);
    assert.equal(wedgedRows.find(row => row.pid === wedge.childPid)?.ppid, wedge.supervisorPid);
    const births = new Map(wedgedRows.map(row => [row.pid, row.started]));
    const supervisor = (await readProcessTable()).find(row => row.pid === wedge.supervisorPid);
    assert.equal(supervisor.started, births.get(wedge.supervisorPid));
    process.kill(wedge.supervisorPid, 'SIGKILL');
    const reparentDeadline = Date.now() + 5_000;
    let orphan;
    do {
      orphan = (await fixture.processTree.inspect()).find(row => row.pid === wedge.childPid);
      if (orphan?.ppid !== wedge.supervisorPid) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < reparentDeadline);
    assert.ok(orphan, 'the owned child must survive controlled reparenting');
    assert.equal(orphan.started, births.get(wedge.childPid));
    assert.notEqual(orphan.ppid, wedge.supervisorPid);
    // This listener is installed only in this isolated test workbench. Its
    // close request remains pending with the real Electron window alive, making
    // the fixture's existing 15-second graceful bound reach owned TERM/KILL.
    await fixture.app.evaluate(({ app }) => {
      app.once('before-quit', event => event.preventDefault());
    });
    const phases = [];
    const result = await measuredCleanup({ ...fixture, processPid: fixture.app.process().pid, phase: details => phases.push(details) });
    assert.equal(result.graceful, false);
    assert.equal(phases.find(details => details.phase === 'graceful-close').outcome, 'timed-out');
    assert.ok(phases.some(details => details.phase === 'owned-sigterm'));
    assert.ok(phases.some(details => details.phase === 'owned-sigkill'));
    assert.deepEqual(result.measurementErrors, []);
    assert.equal(result.forced, true);
    const live = await readProcessTable();
    assert.equal(live.some(row => births.has(row.pid) && births.get(row.pid) === row.started && !row.state.startsWith('Z')), false);
    assert.equal(unrelated.exitCode, null, 'owned cleanup terminated an unrelated control process');
    assert.equal(existsSync(fixture.userDataDir), false);
  } finally {
    unrelated.kill('SIGKILL');
    await recoverFixture(fixture);
    await fixture.processTree.stop().catch(() => {});
  }
});

test('missing inventory retains the real profile after a normal close', { timeout: 180_000 }, async () => {
  const fixture = await launchTrackedCode('missing-inventory');
  let displayClosed = false;
  const windowDisplay = {
    ...fixture.windowDisplay,
    close: async () => {
      displayClosed = true;
      await fixture.windowDisplay.close();
    },
  };
  const pid = fixture.app.process().pid;
  try {
    await assert.rejects(
      cleanupFixture({ ...fixture, processTree: undefined, processPid: pid, windowDisplay }),
      new RegExp(`Cannot verify owned Electron process exit \\(PID ${pid}\\); profile retained at`),
    );
    assert.equal(existsSync(fixture.userDataDir), true);
    assert.equal(displayClosed, true);
    const deadline = Date.now() + 5_000;
    while ((await fixture.processTree.inspect()).length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(await fixture.processTree.inspect(), []);
    rmSync(fixture.userDataDir, { recursive: true, force: true });
  } finally {
    // Recover through bounded exact-tree cleanup while sampling remains active.
    await recoverFixture(fixture);
    await fixture.processTree.stop().catch(() => {});
  }
});
