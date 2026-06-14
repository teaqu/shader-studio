import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

suite('Extension Bundle Test Suite', () => {
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
