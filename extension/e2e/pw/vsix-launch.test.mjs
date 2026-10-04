import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  assertProductionVsixLaunchArgs,
  productionVsixInstallArgs,
  productionVsixInstallEnv,
  productionVsixLaunchArgs,
  cloneProductionVsixSeed,
  installProductionVsix,
} from './vsix-launch.mjs';

const paths = {
  userDataDir: resolve('/tmp/shader-studio-profile'),
  extensionsDir: resolve('/tmp/shader-studio-profile/extensions'),
  bridgeExtensionPath: resolve('/workspace/extension/e2e/pw/bridge-extension'),
  workspacePath: resolve('/workspace/fixture'),
};

test('Windows VSIX install executes the pinned Code CLI without a command shell', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ss windows cli '));
  try {
    const cli = resolve(root, 'bin/code.cmd');
    mkdirSync(resolve(root, 'bin'));
    writeFileSync(cli, 'set VSCODE_DEV=\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\build-id\\resources\\app\\out\\cli.js" %*\r\n');
    const calls = [];
    installProductionVsix({
      vscodeBinary: resolve(root, 'Code.exe'), vsixPath: resolve('package.json'), ...paths,
      resolveCliArgs: () => [cli, '--cli-data-dir=isolated'],
      runCommand: (...args) => {
        calls.push(args);
        return { status: 0 };
      },
    });
    assert.equal(calls[0][0], resolve(root, 'Code.exe'));
    assert.equal(calls[0][1][0], resolve(root, 'build-id/resources/app/out/cli.js'));
    assert.equal(calls[0][1][1], '--cli-data-dir=isolated');
    assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(calls[0][2].env.VSCODE_DEV, '');
    assert.equal(calls[0][2].shell, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows VSIX install rejects an unrecognized launcher before executing it', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ss-windows-cli-'));
  try {
    const cli = resolve(root, 'code.cmd');
    writeFileSync(cli, 'unexpected launcher');
    assert.throws(() => installProductionVsix({
      vscodeBinary: resolve(root, 'Code.exe'), vsixPath: resolve('package.json'), ...paths,
      resolveCliArgs: () => [cli], runCommand: () => ({ status: 0 }),
    }), /Windows VS Code CLI launcher/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows VSIX install rejects a launcher for a different executable', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'ss-windows-cli-'));
  try {
    const cli = resolve(root, 'code.cmd');
    writeFileSync(cli, '"%~dp0other\\Code.exe" "%~dp0resources\\app\\out\\cli.js" %*');
    assert.throws(() => installProductionVsix({
      vscodeBinary: resolve(root, 'Code.exe'), vsixPath: resolve('package.json'), ...paths,
      resolveCliArgs: () => [cli], runCommand: () => {
        throw new Error('must not execute');
      },
    }), /Windows VS Code CLI launcher/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('production VSIX install propagates launcher read and process startup errors', () => {
  const options = { vscodeBinary: resolve('/mock/Code.exe'), vsixPath: resolve('package.json'), ...paths };
  assert.throws(() => installProductionVsix({
    ...options, resolveCliArgs: () => [resolve('/missing/code.cmd')],
  }), /ENOENT/);
  const failure = new Error('spawn failed');
  assert.throws(() => installProductionVsix({
    ...options, resolveCliArgs: () => [resolve('/mock/code')], runCommand: () => ({ error: failure }),
  }), error => error === failure);
});

test('production VSIX launch uses isolated directories, the bridge, and no source extension', () => {
  const args = productionVsixLaunchArgs(paths);

  assert.ok(args.includes(`--user-data-dir=${paths.userDataDir}`));
  assert.ok(args.includes(`--extensions-dir=${paths.extensionsDir}`));
  assert.ok(args.includes(`--extensionDevelopmentPath=${paths.bridgeExtensionPath}`));
  assert.equal(args.some((arg) => arg === '--disable-extensions'), false);
  assert.equal(args.some((arg) => arg === `--extensionDevelopmentPath=${resolve('/workspace/extension')}`), false);
  assertProductionVsixLaunchArgs(args, paths.bridgeExtensionPath);
});

test('production VSIX launch validation rejects a source development extension and disabled extensions', () => {
  const args = productionVsixLaunchArgs(paths);
  assert.throws(
    () => assertProductionVsixLaunchArgs([...args, `--extensionDevelopmentPath=${resolve('/workspace/extension')}`], paths.bridgeExtensionPath),
    /only the test bridge/,
  );
  assert.throws(
    () => assertProductionVsixLaunchArgs([...args, '--disable-extensions'], paths.bridgeExtensionPath),
    /disabled installed extensions/,
  );
});

test('production VSIX launch requires every isolated path', () => {
  assert.throws(
    () => productionVsixLaunchArgs({ ...paths, extensionsDir: '' }),
    /extensionsDir is required/,
  );
});

test('production VSIX install uses the same isolated profile and removes extension-host environment', () => {
  const args = productionVsixInstallArgs({ ...paths, vsixPath: resolve('/workspace/shader-studio.vsix') });
  assert.deepEqual(args, [
    '--install-extension', resolve('/workspace/shader-studio.vsix'),
    `--user-data-dir=${paths.userDataDir}`,
    `--extensions-dir=${paths.extensionsDir}`,
    '--force',
  ]);
  assert.deepEqual(
    productionVsixInstallEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', VSCODE_IPC_HOOK: 'x', KEEP: 'yes' }),
    { PATH: '/bin', KEEP: 'yes' },
  );
});

test('production VSIX install uses VS Code CLI arguments rather than the Electron executable', () => {
  const calls = [];
  const archive = resolve('package.json');
  installProductionVsix({
    vscodeBinary: resolve('/Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
    vsixPath: archive,
    ...paths,
    resolveCliArgs: () => [resolve('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'), '--cli-data-dir=/tmp/cli'],
    runCommand: (...args) => {
      calls.push(args);
      return { status: 0, stderr: '', stdout: '' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], resolve('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'));
  assert.deepEqual(calls[0][1], [
    '--cli-data-dir=/tmp/cli',
    '--install-extension', archive,
    `--user-data-dir=${paths.userDataDir}`,
    `--extensions-dir=${paths.extensionsDir}`,
    '--force',
  ]);
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
});

test('production VSIX install rejects a missing archive before invoking VS Code', () => {
  assert.throws(() => installProductionVsix({
    vscodeBinary: resolve('/Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
    vsixPath: resolve('/missing/shader-studio.vsix'),
    ...paths,
    runCommand: () => {
      throw new Error('must not launch');
    },
  }), /Production VSIX does not exist/);
});

test('production VSIX install reports a failed VS Code CLI invocation', () => {
  const archive = resolve('package.json');
  assert.throws(() => installProductionVsix({
    vscodeBinary: resolve('/Applications/Visual Studio Code.app/Contents/MacOS/Electron'),
    vsixPath: archive,
    ...paths,
    resolveCliArgs: () => [resolve('/mock/code')],
    runCommand: () => ({ status: 1, stderr: 'invalid extension archive', stdout: '' }),
  }), /VSIX installation failed \(1\): invalid extension archive/);
});

test('production VSIX seed cloning copies an immutable installed extension into a fresh profile', () => {
  const calls = [];
  cloneProductionVsixSeed({
    seedExtensionsDir: resolve('/tmp/shader-studio-seed/extensions'),
    extensionsDir: resolve('/tmp/shader-studio-profile/extensions'),
    copy: (...args) => calls.push(args),
    exists: () => true,
  });
  assert.deepEqual(calls, [[
    resolve('/tmp/shader-studio-seed/extensions'),
    resolve('/tmp/shader-studio-profile/extensions'),
    { recursive: true, force: false, errorOnExist: true },
  ]]);
});

test('production VSIX seed cloning rejects a missing seed and propagates copy errors', () => {
  assert.throws(() => cloneProductionVsixSeed({
    seedExtensionsDir: resolve('/missing/seed'), extensionsDir: resolve('/tmp/worker/extensions'), exists: () => false,
  }), /seed does not exist/);
  assert.throws(() => cloneProductionVsixSeed({
    seedExtensionsDir: resolve('/tmp/seed'), extensionsDir: resolve('/tmp/worker/extensions'), exists: () => true,
    copy: () => {
      throw new Error('copy failed');
    },
  }), /copy failed/);
});
