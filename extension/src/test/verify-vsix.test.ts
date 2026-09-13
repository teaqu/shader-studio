import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const scriptUrl = pathToFileURL(
  path.resolve(__dirname, '..', '..', 'scripts', 'verify-vsix.mjs'),
).href;

type Checker = {
  unresolvableRuntimeModules(source: string): string[];
  checkExtensionDirectory(dir: string): Promise<string[]>;
  checkVsix(vsixPath: string, run?: unknown): Promise<string[]>;
};

/**
 * The checks that stand between a `--no-dependencies` package and a release
 * where a whole feature is missing its engine.
 */
suite('VSIX runtime verification', () => {
  let checker: Checker;
  let workspace: string;

  suiteSetup(async () => {
    checker = await import(scriptUrl) as unknown as Checker;
  });

  setup(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-verify-'));
  });

  teardown(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const writeExtension = (files: Record<string, string | Buffer>): string => {
    const root = path.join(workspace, 'extension');
    for (const [name, contents] of Object.entries(files)) {
      const filePath = path.join(root, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, contents as any);
    }
    return root;
  };

  const leb128 = (value: number): Buffer => {
    const bytes: number[] = [];
    let remaining = value;
    do {
      const byte = remaining & 0x7f;
      remaining >>>= 7;
      bytes.push(remaining > 0 ? byte | 0x80 : byte);
    } while (remaining > 0);
    return Buffer.from(bytes);
  };

  /** A valid empty module padded past the size floor with a custom section. */
  const wasmAsset = (): Buffer => {
    const name = Buffer.from([0x01, 0x61]); // one-byte section name: "a"
    const padding = Buffer.alloc(1_048_576);
    const payload = Buffer.concat([name, padding]);
    return Buffer.concat([
      Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
      Buffer.from([0x00]),
      leb128(payload.length),
      payload,
    ]);
  };

  suite('unresolvableRuntimeModules', () => {
    test('ignores builtins, the host module, relative paths, and optional natives', () => {
      const source = `
        const fs = require("fs");
        const p = require("node:path");
        const vscode = require("vscode");
        const local = require("./Logger");
        const rooted = require("/abs/path");
        try { require("bufferutil"); } catch {}
      `;

      assert.deepStrictEqual(checker.unresolvableRuntimeModules(source), []);
    });

    test('reports a package required at runtime', () => {
      const source = 'const t = require("glsl-transpiler");';

      assert.deepStrictEqual(checker.unresolvableRuntimeModules(source), ['glsl-transpiler']);
    });

    test('reports a package reached by dynamic import, as esbuild was', () => {
      // The 1.1.0 break was `await import("esbuild")`, not a require.
      const source = 'async function f() { return await import("esbuild"); }';

      assert.deepStrictEqual(checker.unresolvableRuntimeModules(source), ['esbuild']);
    });

    test('lists each missing package once, sorted', () => {
      const source = `
        require("esbuild"); import("esbuild");
        require("glsl-transpiler");
      `;

      assert.deepStrictEqual(
        checker.unresolvableRuntimeModules(source),
        ['esbuild', 'glsl-transpiler'],
      );
    });
  });

  suite('checkExtensionDirectory', () => {
    test('passes a package carrying every module and asset it needs', async () => {
      const root = writeExtension({
        'dist/extension.js': `${'// padding\n'.repeat(20_000)}require("vscode");`,
        'dist/esbuild.wasm': wasmAsset(),
      });

      assert.deepStrictEqual(await checker.checkExtensionDirectory(root), []);
    });

    test('fails the package that shipped: no engine, and imports nothing provides', async () => {
      const root = writeExtension({
        'dist/extension.js': `${'// padding\n'.repeat(20_000)}await import("esbuild");`,
      });

      const problems = await checker.checkExtensionDirectory(root);

      assert.ok(problems.some((p) => p.includes('missing dist/esbuild.wasm')), problems.join('\n'));
      assert.ok(problems.some((p) => p.includes('"esbuild"')), problems.join('\n'));
    });

    test('rejects a truncated wasm asset', async () => {
      const root = writeExtension({
        'dist/extension.js': `${'// padding\n'.repeat(20_000)}require("vscode");`,
        'dist/esbuild.wasm': Buffer.alloc(64),
      });

      const problems = await checker.checkExtensionDirectory(root);

      assert.ok(problems.some((p) => p.includes('esbuild.wasm is 64 bytes')), problems.join('\n'));
    });

    test('rejects a wasm asset that is not a loadable module', async () => {
      const root = writeExtension({
        'dist/extension.js': `${'// padding\n'.repeat(20_000)}require("vscode");`,
        'dist/esbuild.wasm': Buffer.alloc(1_048_576, 7),
      });

      const problems = await checker.checkExtensionDirectory(root);

      assert.ok(
        problems.some((p) => p.includes('not a loadable WebAssembly module')),
        problems.join('\n'),
      );
    });

    test('rejects a missing or stub bundle', async () => {
      const root = writeExtension({ 'dist/extension.js': 'require("vscode");' });

      const problems = await checker.checkExtensionDirectory(root);

      assert.ok(problems.some((p) => p.includes('dist/extension.js is')), problems.join('\n'));
    });
  });

  suite('checkVsix', () => {
    test('unpacks the archive and checks what is inside it', async () => {
      const root = writeExtension({
        'dist/extension.js': `${'// padding\n'.repeat(20_000)}require("vscode");`,
        'dist/esbuild.wasm': wasmAsset(),
      });
      const unpacked = path.dirname(root);
      const calls: string[][] = [];
      const run = (command: string, args: string[]) => {
        calls.push([command, ...args]);
        // Stand in for unzip: hand back a tree shaped like an unpacked VSIX.
        const destination = args[args.indexOf('-d') + 1];
        fs.cpSync(unpacked, destination, { recursive: true });
      };

      const problems = await checker.checkVsix('/tmp/example.vsix', run as any);

      assert.deepStrictEqual(problems, []);
      assert.strictEqual(calls[0][0], 'unzip');
    });
  });
});
