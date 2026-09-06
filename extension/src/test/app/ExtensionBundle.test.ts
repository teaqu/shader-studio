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

  test('ships a browser entry whose only external is vscode', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const bundlePath = path.join(extensionRoot, 'dist', 'extension-web.js');
    assert.ok(fs.existsSync(bundlePath), 'web bundle must exist for vscode.dev');
    const bundle = fs.readFileSync(bundlePath, 'utf8');
    const externals = [...bundle.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.ok(externals.length > 0, 'expected the web bundle to require vscode');
    assert.deepStrictEqual([...new Set(externals)].sort(), ['vscode']);
  });

  test('loads the Slang language service in the browser entry without Node builtins', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const bundle = fs.readFileSync(path.join(extensionRoot, 'dist', 'extension-web.js'), 'utf8');
    // The web Slang factory must resolve the same Emscripten runtime and WASM
    // manifest as the desktop loader, through extension-URI-safe APIs.
    for (const expected of ['slang-wasm.mjs', 'slang-assets.json', 'SlangLanguageService']) {
      assert.ok(bundle.includes(expected), `web bundle must reference ${expected}`);
    }
    for (const forbidden of ['require("fs")', 'require("path")', 'require("url")', 'Buffer.from', 'process.env']) {
      assert.ok(!bundle.includes(forbidden), `web bundle must not reference ${forbidden}`);
    }
  });

  test('keeps Node-only runtime globals out of the browser entry', () => {
    const extensionRoot = path.resolve(__dirname, '..', '..', '..');
    const bundle = fs.readFileSync(path.join(extensionRoot, 'dist', 'extension-web.js'), 'utf8');
    // esbuild platform 'browser' rejects Node builtin imports at build time,
    // but globals like Buffer slip through and would throw in the web worker.
    for (const forbidden of ['Buffer.from', 'child_process', 'process.env']) {
      assert.ok(!bundle.includes(forbidden), `web bundle must not reference ${forbidden}`);
    }
  });

  test('loads the browser entry with a stubbed vscode module', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const bundlePath = path.join(repoRoot, 'dist', 'extension-web.js');
    assert.ok(fs.existsSync(bundlePath), 'web bundle must exist before smoke test');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-web-bundle-'));
    try {
      const tempBundlePath = path.join(tempDir, 'extension-web.js');
      const vscodeModuleDir = path.join(tempDir, 'node_modules', 'vscode');
      fs.mkdirSync(vscodeModuleDir, { recursive: true });
      fs.copyFileSync(bundlePath, tempBundlePath);
      fs.writeFileSync(
        path.join(vscodeModuleDir, 'index.js'),
        'const vscodeProxy = new Proxy(function vscode() {}, { get: () => vscodeProxy, apply: () => vscodeProxy, construct: () => vscodeProxy }); module.exports = vscodeProxy;',
      );

      execFileSync(process.execPath, ['-e', `const entry = require(${JSON.stringify(tempBundlePath)}); if (typeof entry.activate !== 'function' || typeof entry.deactivate !== 'function') { throw new Error('web entry must export activate/deactivate'); }`], {
        cwd: tempDir,
        stdio: 'pipe',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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
