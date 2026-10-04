import { cpSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, sep } from 'node:path';
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

function windowsCliCommand(cli, executable) {
  // The pinned Windows launcher supplies the versioned cli.js path. Execute
  // that script with Code.exe rather than spawning .cmd or interpolating a shell.
  const launcher = readFileSync(cli, 'utf8');
  const invocation = launcher.match(/"%~dp0([^"\r\n]+Code\.exe)"\s+"%~dp0([^"\r\n]+cli\.js)"/i);
  const fromLauncher = value => resolve(dirname(cli), value.replaceAll('\\', sep));
  if (!invocation || fromLauncher(invocation[1]).toLowerCase() !== executable.toLowerCase()) {
    throw new Error(`Unrecognized Windows VS Code CLI launcher: ${cli}`);
  }
  return [executable, fromLauncher(invocation[2])];
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
  const windowsLauncher = cli.toLowerCase().endsWith('.cmd');
  const [command, ...prefixArgs] = windowsLauncher ? windowsCliCommand(cli, executable) : [cli];
  const environment = productionVsixInstallEnv();
  if (windowsLauncher) {
    environment.ELECTRON_RUN_AS_NODE = '1';
    environment.VSCODE_DEV = '';
  }
  const result = runCommand(command, [...prefixArgs, ...cliArgs, ...productionVsixInstallArgs({ vsixPath: archive, userDataDir, extensionsDir })], {
    encoding: 'utf8',
    env: environment,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`VSIX installation failed (${result.status}): ${result.stderr || result.stdout}`);
  }
}

/**
 * Give each worker an independent extension directory without repeating the
 * VS Code CLI install. The source is a job-local seed produced from the exact
 * archive under test; `errorOnExist` makes accidental profile sharing fail.
 */
export function cloneProductionVsixSeed({ seedExtensionsDir, extensionsDir, copy = cpSync, exists = existsSync }) {
  const seed = requiredPath(seedExtensionsDir, 'seedExtensionsDir');
  const target = requiredPath(extensionsDir, 'extensionsDir');
  if (!exists(seed)) {
    throw new Error(`Production VSIX seed does not exist: ${seed}`);
  }
  copy(seed, target, { recursive: true, force: false, errorOnExist: true });
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
