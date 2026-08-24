import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

suite('Extension Bundle Test Suite', () => {
  test('packages one shared Slang WASM for the webview and direct language service', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'ui-dist', 'slang-assets.json'), 'utf8')) as { wasm: string };
    assert.match(manifest.wasm, /^assets\/[^/]+\.wasm$/);
    assert.ok(fs.existsSync(path.join(extensionRoot, 'ui-dist', manifest.wasm)));
    assert.strictEqual(fs.existsSync(path.join(extensionRoot, 'dist', 'slang-wasm.wasm')), false);
  });

  test('keeps the generated Slang ESM runtime outside the CommonJS extension bundle', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const bundle = fs.readFileSync(path.join(extensionRoot, 'dist', 'extension.js'), 'utf8');
    const runtimePath = path.join(extensionRoot, 'dist', 'slang-wasm.mjs');
    assert.ok(fs.existsSync(runtimePath));
    assert.ok(!bundle.includes('createRequire2(import_meta.url)'));
  });

  test('loads without runtime-only bundler dependencies installed', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const bundlePath = path.join(repoRoot, 'dist', 'extension.js');
    assert.ok(fs.existsSync(bundlePath), 'extension bundle must exist before smoke test');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-bundle-'));
    try {
      const tempDistDir = path.join(tempDir, 'dist');
      const tempBundlePath = path.join(tempDistDir, 'extension.js');
      const vscodeModuleDir = path.join(tempDir, 'node_modules', 'vscode');
      const glslTranspilerModuleDir = path.join(tempDistDir, 'node_modules', 'glsl-transpiler');
      fs.mkdirSync(tempDistDir, { recursive: true });
      fs.mkdirSync(vscodeModuleDir, { recursive: true });
      fs.mkdirSync(glslTranspilerModuleDir, { recursive: true });
      fs.copyFileSync(bundlePath, tempBundlePath);
      fs.writeFileSync(
        path.join(vscodeModuleDir, 'index.js'),
        `
          module.exports = {
            commands: { registerCommand() { return { dispose() {} }; } },
            window: {},
            workspace: {},
            Uri: { parse(value) { return { toString: () => value }; }, joinPath() { return { fsPath: '' }; } },
            EventEmitter: class { constructor() { this.event = () => {}; } dispose() {} },
            StatusBarAlignment: { Left: 1, Right: 2 },
            ThemeColor: class {},
          };
        `,
      );
      fs.writeFileSync(
        path.join(glslTranspilerModuleDir, 'index.js'),
        'module.exports = function transpiler() { return function compile() { return ""; }; };',
      );

      execFileSync(process.execPath, ['-e', `require(${JSON.stringify(tempBundlePath)})`], {
        cwd: tempDir,
        stdio: 'pipe',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
