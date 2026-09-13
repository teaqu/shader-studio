import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
  assertProductionVsixLaunchArgs,
  productionVsixInstallArgs,
  productionVsixInstallEnv,
  productionVsixLaunchArgs,
  installProductionVsix,
} from './vsix-launch.mjs';

const paths = {
  userDataDir: '/tmp/shader-studio-profile',
  extensionsDir: '/tmp/shader-studio-profile/extensions',
  bridgeExtensionPath: '/workspace/extension/e2e/pw/bridge-extension',
  workspacePath: '/workspace/fixture',
};

test('production VSIX launch uses isolated directories, the bridge, and no source extension', () => {
  const args = productionVsixLaunchArgs(paths);

  assert.ok(args.includes('--user-data-dir=/tmp/shader-studio-profile'));
  assert.ok(args.includes('--extensions-dir=/tmp/shader-studio-profile/extensions'));
  assert.ok(args.includes('--extensionDevelopmentPath=/workspace/extension/e2e/pw/bridge-extension'));
  assert.equal(args.some((arg) => arg === '--disable-extensions'), false);
  assert.equal(args.some((arg) => arg === '--extensionDevelopmentPath=/workspace/extension'), false);
  assertProductionVsixLaunchArgs(args, paths.bridgeExtensionPath);
});

test('production VSIX launch validation rejects a source development extension and disabled extensions', () => {
  const args = productionVsixLaunchArgs(paths);
  assert.throws(
    () => assertProductionVsixLaunchArgs([...args, '--extensionDevelopmentPath=/workspace/extension'], paths.bridgeExtensionPath),
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
  const args = productionVsixInstallArgs({ ...paths, vsixPath: '/workspace/shader-studio.vsix' });
  assert.deepEqual(args, [
    '--install-extension', '/workspace/shader-studio.vsix',
    '--user-data-dir=/tmp/shader-studio-profile',
    '--extensions-dir=/tmp/shader-studio-profile/extensions',
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
    vscodeBinary: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    vsixPath: archive,
    ...paths,
    resolveCliArgs: () => ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '--cli-data-dir=/tmp/cli'],
    runCommand: (...args) => {
      calls.push(args);
      return { status: 0, stderr: '', stdout: '' };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
  assert.deepEqual(calls[0][1], [
    '--cli-data-dir=/tmp/cli',
    '--install-extension', archive,
    '--user-data-dir=/tmp/shader-studio-profile',
    '--extensions-dir=/tmp/shader-studio-profile/extensions',
    '--force',
  ]);
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, undefined);
});

test('production VSIX install rejects a missing archive before invoking VS Code', () => {
  assert.throws(() => installProductionVsix({
    vscodeBinary: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    vsixPath: '/missing/shader-studio.vsix',
    ...paths,
    runCommand: () => {
      throw new Error('must not launch');
    },
  }), /Production VSIX does not exist/);
});

test('production VSIX install reports a failed VS Code CLI invocation', () => {
  const archive = resolve('package.json');
  assert.throws(() => installProductionVsix({
    vscodeBinary: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    vsixPath: archive,
    ...paths,
    resolveCliArgs: () => ['/mock/code'],
    runCommand: () => ({ status: 1, stderr: 'invalid extension archive', stdout: '' }),
  }), /VSIX installation failed \(1\): invalid extension archive/);
});
