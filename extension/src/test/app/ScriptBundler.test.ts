import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createRequire } from 'module';
import * as sinon from 'sinon';
import { ScriptBundler } from '../../app/ScriptBundler';
import { Logger } from '../../app/services/Logger';

/**
 * The bundler's contract, independent of which engine implements it: strip
 * TypeScript, inline relative imports, and leave bare package imports as
 * runtime requires resolved from the script's own directory - which is what
 * lets a script reach npm packages and Node built-ins.
 */
suite('ScriptBundler', () => {
  let workspace: string;
  let sandbox: sinon.SinonSandbox;

  setup(() => {
    sandbox = sinon.createSandbox();
    Logger.initialize({
      info: sandbox.stub(),
      debug: sandbox.stub(),
      trace: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      dispose: sandbox.stub(),
    } as any);
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-bundler-'));
  });

  teardown(() => {
    sandbox.restore();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const write = (name: string, contents: string): string => {
    const filePath = path.join(workspace, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, 'utf8');
    return filePath;
  };

  /** Runs the bundle the way ScriptEvaluator does. */
  const evaluate = (code: string, scriptPath: string): any => {
    const sandbox: any = {
      __shaderUniforms: undefined,
      console,
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      require: createRequire(scriptPath),
    };
    vm.createContext(sandbox);
    new vm.Script(`${code}\n`, { filename: 'uniforms-script.js' }).runInContext(sandbox);
    return sandbox.__shaderUniforms;
  };

  test('strips TypeScript and exposes uniforms under the bundle global', async () => {
    const scriptPath = write('uniforms.ts', `
      type Ctx = { iTime: number };
      export function uniforms(ctx: Ctx): Record<string, number> {
        return { iDayOfWeek: 3, uTime: ctx.iTime };
      }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.error, undefined);
    assert.strictEqual(result.success, true);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({ iTime: 2 }) }, { iDayOfWeek: 3, uTime: 2 });
  });

  test('inlines a relative import so a multi-file script loads as one bundle', async () => {
    write('day.ts', 'export const day = () => 5;\n');
    const scriptPath = write('uniforms.ts', `
      import { day } from './day';
      export function uniforms() {
        return { iDayOfWeek: day() };
      }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { iDayOfWeek: 5 });
  });

  for (const [extension, contents, importStatement] of [
    ['.ts', 'export const value: number = 1;\n', "import { value } from './dependency';"],
    ['.tsx', 'export const value = 2;\n', "import { value } from './dependency';"],
    ['.mts', 'export const value: number = 3;\n', "import { value } from './dependency';"],
    ['.cts', 'export const value: number = 4;\n', "import { value } from './dependency';"],
    ['.js', 'export const value = 5;\n', "import { value } from './dependency';"],
    ['.mjs', 'export const value = 6;\n', "import { value } from './dependency';"],
    ['.cjs', 'exports.value = 7;\n', "import { value } from './dependency';"],
    ['.jsx', 'export const value = 8;\n', "import { value } from './dependency';"],
    ['.json', '{"value": 9}\n', "import dependency from './dependency';"],
  ] as const) {
    test(`resolves an extensionless ${extension} dependency`, async () => {
      write(`dependency${extension}`, contents);
      const scriptPath = write('uniforms.ts', `
        ${importStatement}
        export function uniforms() { return { uValue: ${extension === '.json' ? 'dependency.value' : 'value'} }; }
      `);

      const result = await new ScriptBundler().bundle(scriptPath);

      assert.strictEqual(result.success, true, result.error);
      const module = evaluate(result.code!, scriptPath);
      assert.deepStrictEqual({ ...module.uniforms({}) }, { uValue: Number(contents.match(/\d+/)?.[0]) });
    });
  }

  test('prefers TypeScript when extensionless resolution finds multiple supported files', async () => {
    write('dependency.ts', 'export const value = "typescript";\n');
    write('dependency.js', 'export const value = "javascript";\n');
    const scriptPath = write('uniforms.ts', `
      import { value } from './dependency';
      export function uniforms() { return { uValue: value }; }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { uValue: 'typescript' });
  });

  test('resolves a directory dependency through its index file', async () => {
    write('dependency/index.ts', 'export const value = 10;\n');
    const scriptPath = write('uniforms.ts', `
      import { value } from './dependency';
      export function uniforms() { return { uValue: value }; }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { uValue: 10 });
  });

  test('resolves a dependency imported with its explicit extension', async () => {
    write('dependency.json', '{"value": 11}\n');
    const scriptPath = write('uniforms.ts', `
      import dependency from './dependency.json';
      export function uniforms() { return { uValue: dependency.value }; }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { uValue: 11 });
  });

  test('reports a missing relative dependency instead of throwing', async () => {
    const scriptPath = write('uniforms.ts', `
      import { value } from './absent';
      export function uniforms() { return { uValue: value }; }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, false);
    assert.ok(result.error && result.error.length > 0, 'no reason given for the failure');
    assert.strictEqual(result.code, undefined);
  });

  test('leaves bare package imports as runtime requires from the script directory', async () => {
    write('node_modules/fake-sensor/package.json', '{"name":"fake-sensor","main":"index.js"}');
    write('node_modules/fake-sensor/index.js', 'module.exports = { read: () => 7 };\n');
    const scriptPath = write('uniforms.ts', `
      import * as sensor from 'fake-sensor';
      export function uniforms() {
        return { uReading: sensor.read() };
      }
    `);

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    // Bundling the package instead would defeat resolving it from the user's
    // own node_modules, which is the documented behaviour.
    assert.ok(/require\(["']fake-sensor["']\)/.test(result.code!), 'package was inlined instead of required');
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { uReading: 7 });
  });

  test('bundles unsaved editor content against the script directory', async () => {
    write('day.ts', 'export const day = () => 1;\n');
    const scriptPath = path.join(workspace, 'uniforms.ts');

    const result = await new ScriptBundler().bundle(scriptPath, `
      import { day } from './day';
      export function uniforms() { return { iDayOfWeek: day() }; }
    `);

    assert.strictEqual(result.success, true, result.error);
    const module = evaluate(result.code!, scriptPath);
    assert.deepStrictEqual({ ...module.uniforms({}) }, { iDayOfWeek: 1 });
  });

  test('leaves no browser globals behind on the extension host', async () => {
    // The wasm engine needs `self` while it starts. Leaving it defined tells
    // every other library in this host that it is running in a browser.
    const scriptPath = write('uniforms.ts', 'export function uniforms() { return { uOne: 1 }; }\n');

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, true, result.error);
    assert.strictEqual('self' in (globalThis as any), false, '`self` was left defined on the host');
  });

  test('reports a syntax error instead of throwing', async () => {
    const scriptPath = write('uniforms.ts', 'export function uniforms( {\n');

    const result = await new ScriptBundler().bundle(scriptPath);

    assert.strictEqual(result.success, false);
    assert.ok(result.error && result.error.length > 0, 'no reason given for the failure');
    assert.strictEqual(result.code, undefined);
  });

  test('reports a missing entry file instead of throwing', async () => {
    const result = await new ScriptBundler().bundle(path.join(workspace, 'absent.ts'));

    assert.strictEqual(result.success, false);
    assert.ok(result.error && result.error.length > 0, 'no reason given for the failure');
  });
});
