import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const extensionRoot = path.resolve(__dirname, '..', '..');

/**
 * The VSIX is packaged with `--no-dependencies`, so it ships no node_modules at
 * all. Anything the bundler is told to leave external must therefore be
 * provided by the host at runtime, or the feature that imports it is dead in
 * every published release while working perfectly in the development host.
 *
 * That is exactly how custom uniform scripts shipped broken: `esbuild` was
 * external, absent from the VSIX, and every script load failed with
 * "Cannot find package 'esbuild'".
 */
suite('Modules the packaged extension can resolve at runtime', () => {
  /** Provided by the extension host itself, never packaged. */
  const HOST_PROVIDED = new Set(['vscode']);

  const readBuildScript = (): string => (
    fs.readFileSync(path.join(extensionRoot, 'esbuild.js'), 'utf8')
  );

  const declaredExternals = (): string[] => {
    const match = /external:\s*\[([^\]]*)\]/.exec(readBuildScript());
    assert.ok(match, 'esbuild.js no longer declares an external list');
    return [...match![1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
  };

  test('leaves nothing external that the VSIX does not carry', () => {
    const packaged = declaredExternals().filter((name) => !HOST_PROVIDED.has(name));
    assert.deepStrictEqual(
      packaged,
      [],
      `these are imported at runtime but ship in neither the bundle nor the VSIX: ${packaged.join(', ')}`,
    );
  });

  test('copies the esbuild wasm binary the script bundler loads into dist', () => {
    const buildScript = readBuildScript();
    assert.ok(
      /esbuild\.wasm/.test(buildScript),
      'esbuild.js never copies esbuild.wasm into dist, so the packaged bundler has no engine',
    );

    const distWasm = path.join(extensionRoot, 'dist', 'esbuild.wasm');
    if (fs.existsSync(path.join(extensionRoot, 'dist', 'extension.js'))) {
      assert.ok(
        fs.existsSync(distWasm),
        'dist/extension.js was built without dist/esbuild.wasm beside it',
      );
      assert.ok(fs.statSync(distWasm).size > 1_000_000, 'dist/esbuild.wasm is truncated');
    }
  });

  test('keeps dist assets out of the packaging ignore list', () => {
    const ignored = fs.readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'));

    for (const pattern of ignored) {
      assert.ok(
        !/^dist(\/|$)/.test(pattern) && !/\*\*\/\*\.wasm$/.test(pattern),
        `.vscodeignore drops runtime assets the extension needs: ${pattern}`,
      );
    }
  });
});
