import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * The VSIX is packaged with `--no-dependencies`: it carries no node_modules at
 * all. Anything the bundle still requires by package name at runtime therefore
 * has to come from the extension host, or the feature importing it is dead in
 * every published release while working perfectly in the development host.
 *
 * That is how custom uniform scripts shipped broken in 1.1.0 - `esbuild` was
 * external, absent from the VSIX, and every script load failed with
 * "Cannot find package 'esbuild'". CI never packaged and looked.
 */

/** Provided by the extension host itself. */
export const HOST_PROVIDED_MODULES = new Set(['vscode']);

/**
 * Optional native accelerators that `ws` requires inside a try/catch and works
 * without. Their absence is by design, not a packaging mistake.
 */
export const OPTIONAL_MODULES = new Set(['bufferutil', 'utf-8-validate']);

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/** The wasm engine the script bundler loads from beside the bundle. */
export const REQUIRED_ASSETS = [
  { path: 'dist/extension.js', minBytes: 100_000 },
  { path: 'dist/esbuild.wasm', minBytes: 1_000_000, wasm: true },
];

/**
 * Bare package names a bundle asks for at runtime that nothing will provide.
 * @param {string} source
 * @returns {string[]}
 */
export function unresolvableRuntimeModules(source) {
  const names = new Set();
  // require() and dynamic import() both survive bundling as a bare specifier.
  // The 1.1.0 failure was an import(), so matching only require() would have
  // let exactly this bug through again.
  const patterns = [
    /require\(\s*["']([^"'`]+)["']\s*\)/g,
    /\bimport\(\s*["']([^"'`]+)["']\s*\)/g,
  ];
  for (const match of patterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
    const name = match[1];
    const isRelative = name.startsWith('.') || name.startsWith('/');
    if (isRelative || BUILTINS.has(name) || HOST_PROVIDED_MODULES.has(name) || OPTIONAL_MODULES.has(name)) {
      continue;
    }
    names.add(name);
  }
  return [...names].sort();
}

/**
 * @param {string} extensionDir root of an unpacked VSIX or an installed extension
 * @returns {Promise<string[]>} one problem per line, empty when the package is sound
 */
export async function checkExtensionDirectory(extensionDir) {
  const problems = [];

  for (const asset of REQUIRED_ASSETS) {
    const assetPath = join(extensionDir, asset.path);
    if (!existsSync(assetPath)) {
      problems.push(`missing ${asset.path}`);
      continue;
    }
    const { size } = statSync(assetPath);
    if (size < asset.minBytes) {
      problems.push(`${asset.path} is ${size} bytes, expected at least ${asset.minBytes}`);
      continue;
    }
    if (asset.wasm) {
      try {
        await WebAssembly.compile(readFileSync(assetPath));
      } catch (error) {
        problems.push(`${asset.path} is not a loadable WebAssembly module: ${error.message}`);
      }
    }
  }

  const distDir = join(extensionDir, 'dist');
  const bundles = existsSync(distDir)
    ? readdirSync(distDir).filter((name) => name.endsWith('.js'))
    : [];
  for (const bundle of bundles) {
    const missing = unresolvableRuntimeModules(readFileSync(join(distDir, bundle), 'utf8'));
    for (const name of missing) {
      problems.push(`dist/${bundle} requires "${name}" at runtime, which the VSIX does not carry`);
    }
  }

  return problems;
}

/**
 * @param {string} vsixPath
 * @param {(command: string, args: readonly string[], options: object) => unknown} [run]
 * @returns {Promise<string[]>}
 */
export async function checkVsix(vsixPath, run = execFileSync) {
  const workDir = mkdtempSync(join(tmpdir(), 'ss-vsix-'));
  try {
    // A VSIX is a zip; Node ships no unzip, and every platform this releases
    // from has one.
    run('unzip', ['-q', '-o', resolve(vsixPath), '-d', workDir], { stdio: 'inherit' });
    return await checkExtensionDirectory(join(workDir, 'extension'));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/verify-vsix.mjs <extension.vsix | unpacked extension directory>');
    process.exit(2);
  }

  const problems = target.endsWith('.vsix')
    ? await checkVsix(target)
    : await checkExtensionDirectory(target);

  if (problems.length > 0) {
    console.error(`${basename(target)} would ship broken:`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  console.log(`${basename(target)}: every runtime module and asset it needs is inside it`);
}

if (process.argv[1] && import.meta.url === `file://${resolve(process.argv[1])}`) {
  await main();
}
