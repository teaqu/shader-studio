import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

function requiredPath(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return resolve(value);
}

/**
 * Install a packaged extension into an isolated VS Code extensions directory.
 * The caller launches the same directory afterwards, so this never falls back
 * to the source checkout's extension-development path.
 */
export function productionVsixInstallEnv(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => (
    key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')
  )));
}

export function productionVsixInstallArgs({ vsixPath, userDataDir, extensionsDir }) {
  const archive = requiredPath(vsixPath, 'vsixPath');
  const profile = requiredPath(userDataDir, 'userDataDir');
  const target = requiredPath(extensionsDir, 'extensionsDir');
  return [
    '--install-extension', archive,
    `--user-data-dir=${profile}`,
    `--extensions-dir=${target}`,
    '--force',
  ];
}

export function installProductionVsix({
  vscodeBinary,
  vsixPath,
  userDataDir,
  extensionsDir,
  runCommand = spawnSync,
  resolveCliArgs = resolveCliArgsFromVSCodeExecutablePath,
}) {
  const executable = requiredPath(vscodeBinary, 'vscodeBinary');
  const archive = requiredPath(vsixPath, 'vsixPath');
  if (!existsSync(archive)) {
    throw new Error(`Production VSIX does not exist: ${archive}`);
  }
  const [cli, ...cliArgs] = resolveCliArgs(executable, { reuseMachineInstall: true });
  const result = runCommand(cli, [...cliArgs, ...productionVsixInstallArgs({ vsixPath: archive, userDataDir, extensionsDir })], {
    encoding: 'utf8',
    env: productionVsixInstallEnv(),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`VSIX installation failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

/** Build launch arguments for a production VSIX with only the test bridge in development mode. */
export function productionVsixLaunchArgs({ userDataDir, extensionsDir, bridgeExtensionPath, workspacePath }) {
  const profile = requiredPath(userDataDir, 'userDataDir');
  const extensions = requiredPath(extensionsDir, 'extensionsDir');
  const bridge = requiredPath(bridgeExtensionPath, 'bridgeExtensionPath');
  const workspace = requiredPath(workspacePath, 'workspacePath');
  const args = [
    '--no-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--extensionDevelopmentPath=${bridge}`,
    `--user-data-dir=${profile}`,
    `--extensions-dir=${extensions}`,
    '--enable-unsafe-webgpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    workspace,
  ];
  return args;
}

/** Verify that launch options contain only the test bridge as a development extension. */
export function assertProductionVsixLaunchArgs(args, bridgeExtensionPath) {
  const bridge = requiredPath(bridgeExtensionPath, 'bridgeExtensionPath');
  const developmentPaths = args
    .filter((arg) => arg.startsWith('--extensionDevelopmentPath='))
    .map((arg) => arg.slice('--extensionDevelopmentPath='.length));
  if (args.includes('--disable-extensions')) {
    throw new Error('Production VSIX launch disabled installed extensions');
  }
  if (developmentPaths.length !== 1 || developmentPaths[0] !== bridge) {
    throw new Error('Production VSIX launch must use only the test bridge as a development extension');
  }
}
