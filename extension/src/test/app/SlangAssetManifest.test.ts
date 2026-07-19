import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSlangAssetPaths } from '../../app/SlangAssetManifest';

suite('SlangAssetManifest Test Suite', () => {
  let extensionPath: string;
  let uiDistPath: string;

  setup(() => {
    extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'slang-assets-test-'));
    uiDistPath = path.join(extensionPath, 'ui-dist');
    fs.mkdirSync(uiDistPath);
  });

  teardown(() => {
    fs.rmSync(extensionPath, { recursive: true, force: true });
  });

  function writeManifest(manifest: unknown): void {
    fs.writeFileSync(
      path.join(uiDistPath, 'slang-assets.json'),
      JSON.stringify(manifest),
      'utf8',
    );
  }

  test('resolves valid asset paths beneath ui-dist', () => {
    writeManifest({
      script: 'assets/slang.js',
      wasm: 'assets/slang.wasm',
      worker: 'assets/slang-worker.js',
    });

    assert.deepStrictEqual(loadSlangAssetPaths(extensionPath), {
      scriptPath: path.join(uiDistPath, 'assets/slang.js'),
      wasmPath: path.join(uiDistPath, 'assets/slang.wasm'),
      workerPath: path.join(uiDistPath, 'assets/slang-worker.js'),
    });
  });

  test('rejects a missing asset key', () => {
    writeManifest({ script: 'slang.js', wasm: 'slang.wasm' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest is missing string key "worker"' },
    );
  });

  test('rejects a traversal outside ui-dist', () => {
    writeManifest({ script: '../slang.js', wasm: 'slang.wasm', worker: 'worker.js' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset path escapes ui-dist: ../slang.js' },
    );
  });

  test('rejects a non-object manifest root', () => {
    writeManifest([]);

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest must be an object' },
    );
  });

  test('rejects an empty asset path', () => {
    writeManifest({ script: '', wasm: 'slang.wasm', worker: 'worker.js' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest is missing string key "script"' },
    );
  });

  test('rejects an absolute asset path outside ui-dist', () => {
    const absolutePath = path.resolve(extensionPath, 'outside', 'slang.js');
    writeManifest({ script: absolutePath, wasm: 'slang.wasm', worker: 'worker.js' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: `Slang asset path escapes ui-dist: ${absolutePath}` },
    );
  });
});
