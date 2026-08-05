import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isPathOutsideRoot,
  loadSlangAssetPaths,
} from '../../app/SlangAssetManifest';

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

  function writeManifestText(manifest: string): void {
    fs.writeFileSync(path.join(uiDistPath, 'slang-assets.json'), manifest, 'utf8');
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

  test('allows a path whose in-root name starts with two dots', () => {
    writeManifest({
      script: '..cache/slang.js',
      wasm: 'slang.wasm',
      worker: 'worker.js',
    });

    assert.strictEqual(
      loadSlangAssetPaths(extensionPath).scriptPath,
      path.join(uiDistPath, '..cache/slang.js'),
    );
  });

  test('propagates an error when the manifest file is missing', () => {
    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { code: 'ENOENT' },
    );
  });

  test('propagates a SyntaxError for malformed JSON', () => {
    writeManifestText('{');

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      SyntaxError,
    );
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

  test('rejects the exact parent directory path', () => {
    writeManifest({ script: '..', wasm: 'slang.wasm', worker: 'worker.js' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset path escapes ui-dist: ..' },
    );
  });

  test('rejects a non-object manifest root', () => {
    writeManifest([]);

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest must be an object' },
    );
  });

  test('rejects a null manifest root', () => {
    writeManifest(null);

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest must be an object' },
    );
  });

  test('rejects a primitive manifest root', () => {
    writeManifest('slang.js');

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest must be an object' },
    );
  });

  test('rejects a present non-string asset path', () => {
    writeManifest({ script: 'slang.js', wasm: 42, worker: 'worker.js' });

    assert.throws(
      () => loadSlangAssetPaths(extensionPath),
      { message: 'Slang asset manifest is missing string key "wasm"' },
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

  test('rejects a Windows cross-volume path through the absolute-relative branch', () => {
    const rootPath = 'C:\\extension\\ui-dist';
    const resolvedPath = 'D:\\assets\\slang.js';
    const relativePath = path.win32.relative(rootPath, resolvedPath);

    assert.ok(path.win32.isAbsolute(relativePath));
    assert.strictEqual(isPathOutsideRoot(rootPath, resolvedPath, path.win32), true);
  });
});
