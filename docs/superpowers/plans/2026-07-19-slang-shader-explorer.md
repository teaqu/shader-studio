# Slang Shader Explorer Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Shader Explorer discover and preview current-format Slang shaders without CSP failures or a duplicate packaged Slang WASM binary.

**Architecture:** The main UI build remains the sole producer of Slang runtime assets and emits a small hash-independent manifest. The extension injects those canonical asset URLs and a Slang-compatible CSP into Shader Explorer, while the Explorer routes source messages through a language-aware engine factory that selects the existing WebGL or WebGPU renderer.

**Tech Stack:** TypeScript, Svelte 5, Vite/Rollup, Vitest, Mocha/Sinon extension tests, VS Code webviews, WebGL, WebGPU, Slang WASM.

---

## File Structure

- Create `ui/viteSlangAssetManifest.ts`
  - Pure asset-name validation plus a Vite plugin that emits `slang-assets.json`.
- Create `ui/src/test/viteSlangAssetManifest.test.ts`
  - Covers complete, missing, and ambiguous build outputs.
- Modify `ui/vite.config.ts`
  - Registers the manifest plugin after the Svelte plugin.
- Create `extension/src/app/SlangAssetManifest.ts`
  - Reads and validates the canonical manifest and resolves safe paths below `ui-dist`.
- Create `extension/src/test/app/SlangAssetManifest.test.ts`
  - Covers valid manifests, missing keys, and traversal attempts.
- Modify `extension/src/app/ShaderExplorerProvider.ts`
  - Discovers Slang, sends language, injects canonical asset URLs, exposes `ui-dist`, and aligns CSP.
- Modify `extension/src/test/app/ShaderExplorerProvider.test.ts`
  - Covers Slang discovery/messages and both CSP-generation branches.
- Modify `shader-explorer/src/lib/shaderCodeRequest.ts`
  - Adds the response language to the webview contract.
- Modify `shader-explorer/src/lib/shaderCodeRequest.test.ts`
  - Proves language survives request/response normalization.
- Create `shader-explorer/src/lib/slangAssets.ts`
  - Reads host-injected canonical Slang URLs from document metadata.
- Create `shader-explorer/src/lib/slangAssets.test.ts`
  - Covers successful lookup and missing metadata.
- Create `shader-explorer/src/lib/engineFactory.ts`
  - Selects the existing backend for `glsl` or `slang`.
- Create `shader-explorer/src/lib/engineFactory.test.ts`
  - Covers WebGL default and WebGPU asset wiring.
- Modify `shader-explorer/src/lib/components/ShaderPreview.svelte`
  - Uses the response language, shared engine interface, and backend-aware cleanup.
- Modify `shader-explorer/src/lib/components/ShaderPreview.test.ts`
  - Covers Slang thumbnail and hover engine selection without regressing GLSL.

---

### Task 1: Emit One Canonical Slang Asset Manifest

**Files:**
- Create: `ui/viteSlangAssetManifest.ts`
- Create: `ui/src/test/viteSlangAssetManifest.test.ts`
- Modify: `ui/vite.config.ts`

- [ ] **Step 1: Write failing manifest-selection tests**

Create `ui/src/test/viteSlangAssetManifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSlangAssetManifest } from '../../viteSlangAssetManifest';

describe('createSlangAssetManifest', () => {
  const files = [
    'assets/index-AbCd.js',
    'assets/slang-wasm-Cc_X-Ge8.js',
    'assets/slang-wasm-YHstDjaa.wasm',
    'assets/slangCompileWorker-DkSXR8_3.js',
  ];

  it('maps exactly one emitted runtime, wasm, and worker asset', () => {
    expect(createSlangAssetManifest(files)).toEqual({
      script: 'assets/slang-wasm-Cc_X-Ge8.js',
      wasm: 'assets/slang-wasm-YHstDjaa.wasm',
      worker: 'assets/slangCompileWorker-DkSXR8_3.js',
    });
  });

  it.each([
    ['runtime', files.filter(file => !file.endsWith('.js') || !file.includes('slang-wasm-'))],
    ['wasm', files.filter(file => !file.endsWith('.wasm'))],
    ['worker', files.filter(file => !file.includes('slangCompileWorker-'))],
  ])('rejects a build missing the %s asset', (label, emittedFiles) => {
    expect(() => createSlangAssetManifest(emittedFiles)).toThrow(
      `Expected exactly one Slang ${label} asset`,
    );
  });

  it('rejects ambiguous duplicate runtime assets', () => {
    expect(() => createSlangAssetManifest([
      ...files,
      'assets/slang-wasm-Other.js',
    ])).toThrow('Expected exactly one Slang runtime asset');
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
cd ui && npx vitest run src/test/viteSlangAssetManifest.test.ts
```

Expected: FAIL because `../../viteSlangAssetManifest` does not exist.

- [ ] **Step 3: Implement the pure selector and Vite plugin**

Create `ui/viteSlangAssetManifest.ts`:

```ts
import type { Plugin } from 'vite';

export interface SlangAssetManifest {
  script: string;
  wasm: string;
  worker: string;
}

function selectExactlyOne(
  files: readonly string[],
  label: string,
  pattern: RegExp,
): string {
  const matches = files.filter(file => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Slang ${label} asset, found ${matches.length}: ${matches.join(', ') || 'none'}`,
    );
  }
  return matches[0];
}

export function createSlangAssetManifest(files: readonly string[]): SlangAssetManifest {
  return {
    script: selectExactlyOne(files, 'runtime', /(^|\/)slang-wasm-[^/]+\.js$/),
    wasm: selectExactlyOne(files, 'wasm', /(^|\/)slang-wasm-[^/]+\.wasm$/),
    worker: selectExactlyOne(files, 'worker', /(^|\/)slangCompileWorker-[^/]+\.js$/),
  };
}

export function slangAssetManifestPlugin(): Plugin {
  return {
    name: 'shader-studio-slang-asset-manifest',
    generateBundle(_options, bundle) {
      const manifest = createSlangAssetManifest(Object.keys(bundle));
      this.emitFile({
        type: 'asset',
        fileName: 'slang-assets.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
```

Modify `ui/vite.config.ts`:

```ts
import { slangAssetManifestPlugin } from './viteSlangAssetManifest';

export default defineConfig({
  plugins: [svelte(), slangAssetManifestPlugin()],
  // retain the existing config unchanged below
});
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
cd ui && npx vitest run src/test/viteSlangAssetManifest.test.ts
```

Expected: PASS with four tests.

- [ ] **Step 5: Build the main UI and verify the manifest**

Ensure the ignored WASM exists in this worktree for the build:

```bash
test -f ui/src/slang/slang-wasm.wasm || cp /Users/calum/Projects/shader-studio-2/ui/src/slang/slang-wasm.wasm ui/src/slang/slang-wasm.wasm
npm run build -w ui
node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("ui/dist/slang-assets.json","utf8")); for (const key of ["script","wasm","worker"]) { if (!fs.existsSync(`ui/dist/${m[key]}`)) throw new Error(`missing ${key}`); } console.log(m);'
```

Expected: the build succeeds and prints three existing `assets/...` paths.

- [ ] **Step 6: Commit**

```bash
git add ui/viteSlangAssetManifest.ts ui/src/test/viteSlangAssetManifest.test.ts ui/vite.config.ts
git commit -m "build(ui): emit Slang asset manifest"
```

---

### Task 2: Load Canonical Slang Assets Safely In The Extension

**Files:**
- Create: `extension/src/app/SlangAssetManifest.ts`
- Create: `extension/src/test/app/SlangAssetManifest.test.ts`

- [ ] **Step 1: Write failing manifest-loader tests**

Create `extension/src/test/app/SlangAssetManifest.test.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSlangAssetPaths } from '../../app/SlangAssetManifest';

suite('SlangAssetManifest', () => {
  let extensionPath: string;

  setup(() => {
    extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-studio-slang-assets-'));
    fs.mkdirSync(path.join(extensionPath, 'ui-dist', 'assets'), { recursive: true });
  });

  teardown(() => fs.rmSync(extensionPath, { recursive: true, force: true }));

  test('resolves valid manifest entries below ui-dist', () => {
    fs.writeFileSync(path.join(extensionPath, 'ui-dist', 'slang-assets.json'), JSON.stringify({
      script: 'assets/slang-wasm-a.js',
      wasm: 'assets/slang-wasm-b.wasm',
      worker: 'assets/slangCompileWorker-c.js',
    }));

    assert.deepStrictEqual(loadSlangAssetPaths(extensionPath), {
      scriptPath: path.join(extensionPath, 'ui-dist', 'assets', 'slang-wasm-a.js'),
      wasmPath: path.join(extensionPath, 'ui-dist', 'assets', 'slang-wasm-b.wasm'),
      workerPath: path.join(extensionPath, 'ui-dist', 'assets', 'slangCompileWorker-c.js'),
    });
  });

  test('rejects missing manifest keys', () => {
    fs.writeFileSync(path.join(extensionPath, 'ui-dist', 'slang-assets.json'), JSON.stringify({
      script: 'assets/slang-wasm-a.js',
    }));
    assert.throws(() => loadSlangAssetPaths(extensionPath), /missing string key "wasm"/);
  });

  test('rejects paths that escape ui-dist', () => {
    fs.writeFileSync(path.join(extensionPath, 'ui-dist', 'slang-assets.json'), JSON.stringify({
      script: '../outside.js',
      wasm: 'assets/slang.wasm',
      worker: 'assets/worker.js',
    }));
    assert.throws(() => loadSlangAssetPaths(extensionPath), /escapes ui-dist/);
  });
});
```

- [ ] **Step 2: Compile the tests and verify RED**

Run:

```bash
npm run compile-tests -w extension
```

Expected: FAIL because `../../app/SlangAssetManifest` does not exist.

- [ ] **Step 3: Implement safe manifest loading**

Create `extension/src/app/SlangAssetManifest.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

export interface SlangAssetPaths {
  scriptPath: string;
  wasmPath: string;
  workerPath: string;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Slang asset manifest is missing string key "${key}"`);
  }
  return value;
}

function resolveInside(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Slang asset path escapes ui-dist: ${relativePath}`);
  }
  return resolved;
}

export function loadSlangAssetPaths(extensionPath: string): SlangAssetPaths {
  const root = path.join(extensionPath, 'ui-dist');
  const manifestPath = path.join(root, 'slang-assets.json');
  const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Slang asset manifest must be an object');
  }
  const record = parsed as Record<string, unknown>;
  return {
    scriptPath: resolveInside(root, requireString(record, 'script')),
    wasmPath: resolveInside(root, requireString(record, 'wasm')),
    workerPath: resolveInside(root, requireString(record, 'worker')),
  };
}
```

- [ ] **Step 4: Compile and run the focused extension suite**

Run:

```bash
npm run compile-tests -w extension
npm test -w extension -- --grep "SlangAssetManifest"
```

Expected: compilation succeeds and all three tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/app/SlangAssetManifest.ts extension/src/test/app/SlangAssetManifest.test.ts
git commit -m "feat(extension): resolve shared Slang assets"
```

---

### Task 3: Inject Shared Assets And A Slang-Compatible Explorer CSP

**Files:**
- Modify: `extension/src/app/ShaderExplorerProvider.ts`
- Modify: `extension/src/test/app/ShaderExplorerProvider.test.ts`

- [ ] **Step 1: Write failing CSP and metadata tests**

Add a `Webview HTML` suite to `extension/src/test/app/ShaderExplorerProvider.test.ts`. Configure the existing filesystem stubs to return this HTML and a valid manifest, then call `provider.show()`:

```ts
suite('Webview HTML', () => {
  function configureBuiltAssets(rawHtml: string) {
    const fs = require('fs');
    (fs.existsSync as sinon.SinonStub).callsFake((filePath: string) =>
      filePath.endsWith('index.html') || filePath.endsWith('slang-assets.json'),
    );
    (fs.readFileSync as sinon.SinonStub).callsFake((filePath: string) => {
      if (filePath.endsWith('index.html')) return rawHtml;
      if (filePath.endsWith('slang-assets.json')) {
        return JSON.stringify({
          script: 'assets/slang-wasm-a.js',
          wasm: 'assets/slang-wasm-b.wasm',
          worker: 'assets/slangCompileWorker-c.js',
        });
      }
      return '';
    });
    mockWebview.cspSource = 'vscode-resource:';
    mockWebview.asWebviewUri = (uri: vscode.Uri) => vscode.Uri.parse(
      `vscode-resource:${uri.fsPath}`,
    );
  }

  test('adds Slang runtime tokens to an existing CSP and injects asset URLs', () => {
    configureBuiltAssets('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src none; script-src vscode-resource:"></head><body></body></html>');
    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

    provider.show();

    const html = mockPanel.webview.html;
    assert.match(html, /script-src[^;]*'unsafe-eval'/);
    assert.match(html, /script-src[^;]*'wasm-unsafe-eval'/);
    assert.match(html, /script-src[^;]*blob:/);
    assert.ok(html.includes('worker-src vscode-resource: blob:'));
    assert.ok(html.includes('connect-src vscode-resource: blob:'));
    assert.ok(html.includes('name="shader-studio-slang-script-url"'));
    assert.ok(html.includes('slang-wasm-a.js'));
    assert.ok(html.includes('slang-wasm-b.wasm'));
    assert.ok(html.includes('slangCompileWorker-c.js'));
  });

  test('creates the same Slang CSP directives when built HTML has no CSP', () => {
    configureBuiltAssets('<!doctype html><html><head></head><body></body></html>');
    sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

    provider.show();

    const html = mockPanel.webview.html;
    assert.match(html, /script-src[^;]*'unsafe-eval'/);
    assert.match(html, /script-src[^;]*'wasm-unsafe-eval'/);
    assert.ok(html.includes('worker-src vscode-resource: blob:'));
    assert.ok(html.includes('connect-src vscode-resource: blob:'));
  });
});
```

Extend the existing panel-options test:

```ts
assert.ok(options.localResourceRoots.some(
  (uri: vscode.Uri) => uri.fsPath.endsWith(path.join('ui-dist')),
));
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run:

```bash
npm run compile-tests -w extension
npm test -w extension -- --grep "Webview HTML|panel options"
```

Expected: FAIL because the CSP lacks the Slang tokens, no metadata exists, and `ui-dist` is not a resource root.

- [ ] **Step 3: Implement URL metadata, resource roots, and CSP tokens**

Modify imports in `ShaderExplorerProvider.ts`:

```ts
import { loadSlangAssetPaths } from './SlangAssetManifest';
```

Add `ui-dist` to `localResourceRoots`:

```ts
vscode.Uri.file(path.join(this.context.extensionPath, 'ui-dist')),
```

Add these private helpers:

```ts
private ensureCspToken(csp: string, directive: string, token: string): string {
  const directivePattern = new RegExp(`${directive}[^;]*`);
  const match = csp.match(directivePattern);
  if (!match) return `${csp}; ${directive} ${token}`;
  const tokens = match[0].split(/\s+/);
  return tokens.includes(token)
    ? csp
    : csp.replace(directivePattern, value => `${value} ${token}`);
}

private escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

private getSlangAssetMetadata(webview: vscode.Webview): string {
  try {
    const assets = loadSlangAssetPaths(this.context.extensionPath);
    const entries = [
      ['shader-studio-slang-script-url', assets.scriptPath],
      ['shader-studio-slang-wasm-url', assets.wasmPath],
      ['shader-studio-slang-worker-url', assets.workerPath],
    ] as const;
    return entries.map(([name, filePath]) => {
      const value = webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
      return `<meta name="${name}" content="${this.escapeHtmlAttribute(value)}">`;
    }).join('');
  } catch (error) {
    this.logger.error(`Slang assets unavailable in Shader Explorer: ${error}`);
    return '';
  }
}
```

After loading and URI-rewriting the HTML, inject metadata inside `<head>`:

```ts
const slangMetadata = this.getSlangAssetMetadata(webview);
const htmlWithSlangAssets = processedHtml.replace(
  /<head([^>]*)>/i,
  `<head$1>${slangMetadata}`,
);
```

Use `htmlWithSlangAssets` for all subsequent CSP matching and replacement. In the existing-CSP branch, add:

```ts
updatedCsp = this.ensureCspToken(updatedCsp, 'script-src', 'blob:');
updatedCsp = this.ensureCspToken(updatedCsp, 'script-src', "'wasm-unsafe-eval'");
updatedCsp = this.ensureCspToken(updatedCsp, 'script-src', "'unsafe-eval'");
updatedCsp = updatedCsp.includes('worker-src')
  ? updatedCsp.replace(/worker-src[^;]*/, `worker-src ${webview.cspSource} blob:`)
  : `${updatedCsp}; worker-src ${webview.cspSource} blob:`;
updatedCsp = updatedCsp.includes('connect-src')
  ? updatedCsp.replace(/connect-src[^;]*/, `connect-src ${webview.cspSource} blob:`)
  : `${updatedCsp}; connect-src ${webview.cspSource} blob:`;
```

Use this exact no-CSP value:

```ts
const newCsp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' ${webview.cspSource} blob: 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self' 'unsafe-inline' ${webview.cspSource}; img-src 'self' data: blob: ${webview.cspSource}; media-src 'self' blob: ${webview.cspSource}; worker-src ${webview.cspSource} blob:; connect-src ${webview.cspSource} blob:; font-src 'self' ${webview.cspSource};">`;
```

- [ ] **Step 4: Run the focused suite and verify GREEN**

Run:

```bash
npm run compile-tests -w extension
npm test -w extension -- --grep "Webview HTML|panel options"
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add extension/src/app/ShaderExplorerProvider.ts extension/src/test/app/ShaderExplorerProvider.test.ts
git commit -m "fix(explorer): allow shared Slang runtime assets"
```

---

### Task 4: Discover Slang And Send Its Language

**Files:**
- Modify: `extension/src/app/ShaderExplorerProvider.ts`
- Modify: `extension/src/test/app/ShaderExplorerProvider.test.ts`
- Modify: `shader-explorer/src/lib/shaderCodeRequest.ts`
- Modify: `shader-explorer/src/lib/shaderCodeRequest.test.ts`

- [ ] **Step 1: Write failing extension discovery and message tests**

Add to the `requestShaders` suite:

```ts
test('discovers Slang shaders alongside GLSL shaders', async () => {
  const slangUri = vscode.Uri.file('/workspace/shaders/clouds.slang');
  sandbox.stub(vscode.workspace, 'workspaceFolders').value([
    { uri: vscode.Uri.file('/workspace') },
  ]);
  sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);
  const findFiles = sandbox.stub(vscode.workspace, 'findFiles').resolves([slangUri]);
  const fs = require('fs');
  sandbox.stub(fs, 'statSync').returns({ mtimeMs: 2_000, birthtimeMs: 1_000 });

  const handler = setupMessageHandler(mockPanel);
  await handler({ type: 'requestShaders' });

  assert.match(findFiles.firstCall.args[0].pattern, /slang/);
  assert.strictEqual(postMessageSpy.firstCall.args[0].shaders[0].path, slangUri.fsPath);
});
```

Add to `requestShaderCode` tests:

```ts
test('labels Slang shader code responses', async () => {
  sandbox.stub(vscode.workspace, 'openTextDocument').resolves({
    getText: () => 'float4 mainImage(float2 c) { return 1; }',
  } as any);
  sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);
  sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async message => message);
  sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

  const handler = setupMessageHandler(mockPanel);
  await handler({ type: 'requestShaderCode', path: '/test/shader.slang' });

  assert.strictEqual(postMessageSpy.firstCall.args[0].language, 'slang');
});

test('keeps GLSL shader code responses labeled glsl', async () => {
  sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ getText: () => 'void main() {}' } as any);
  sandbox.stub(ShaderConfigProcessor.prototype, 'loadAndProcessConfig').returns(null);
  sandbox.stub(ConfigPathConverter, 'processConfigPaths').callsFake(async message => message);
  sandbox.stub(vscode.window, 'createWebviewPanel').returns(mockPanel);

  const handler = setupMessageHandler(mockPanel);
  await handler({ type: 'requestShaderCode', path: '/test/shader.glsl' });

  assert.strictEqual(postMessageSpy.firstCall.args[0].language, 'glsl');
});
```

- [ ] **Step 2: Write a failing webview contract test**

Update the first successful response in `shaderCodeRequest.test.ts` to include `language: 'slang'`, then assert:

```ts
await expect(result).resolves.toMatchObject({
  language: 'slang',
  code: expect.stringContaining('mainImage'),
  config: null,
  buffers: {},
});
```

- [ ] **Step 3: Run both focused suites and verify RED**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/shaderCodeRequest.test.ts
cd ../extension && npm run compile-tests && npm test -- --grep "discovers Slang|labels Slang|labeled glsl"
```

Expected: failures because `.slang` is absent from the glob and `language` is not sent or normalized.

- [ ] **Step 4: Implement discovery and language propagation**

Modify `ShaderExplorerProvider.ts` imports:

```ts
import { getShaderLanguage } from './GlslFileTracker';
```

Change the discovery glob and local names:

```ts
const shaderFiles = await vscode.workspace.findFiles(
  new vscode.RelativePattern(folder, '**/*.{glsl,frag,vert,slang}'),
  '**/node_modules/**',
);
```

Use `shaderFiles` for metadata and iteration. Add to the `shaderCode` message:

```ts
language: getShaderLanguage(shaderPath),
```

Modify `shaderCodeRequest.ts`:

```ts
export type ShaderLanguage = 'glsl' | 'slang';

export interface ShaderCodeResponse {
  code: string;
  config: unknown;
  buffers: Record<string, string>;
  language: ShaderLanguage;
}
```

Normalize the response with a backward-compatible default:

```ts
language: message.language === 'slang' ? 'slang' : 'glsl',
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/shaderCodeRequest.test.ts
cd ../extension && npm run compile-tests && npm test -- --grep "discovers Slang|labels Slang|labeled glsl"
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src/app/ShaderExplorerProvider.ts extension/src/test/app/ShaderExplorerProvider.test.ts shader-explorer/src/lib/shaderCodeRequest.ts shader-explorer/src/lib/shaderCodeRequest.test.ts
git commit -m "feat(explorer): discover Slang shader sources"
```

---

### Task 5: Select The Existing Slang Engine In Shader Explorer

**Files:**
- Create: `shader-explorer/src/lib/slangAssets.ts`
- Create: `shader-explorer/src/lib/slangAssets.test.ts`
- Create: `shader-explorer/src/lib/engineFactory.ts`
- Create: `shader-explorer/src/lib/engineFactory.test.ts`

- [ ] **Step 1: Write failing injected-asset tests**

Create `shader-explorer/src/lib/slangAssets.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { getSlangAssetUrls } from './slangAssets';

describe('getSlangAssetUrls', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('reads all canonical URLs injected by the extension host', () => {
    document.head.innerHTML = `
      <meta name="shader-studio-slang-script-url" content="vscode-resource:/ui/slang.js">
      <meta name="shader-studio-slang-wasm-url" content="vscode-resource:/ui/slang.wasm">
      <meta name="shader-studio-slang-worker-url" content="vscode-resource:/ui/worker.js">
    `;
    expect(getSlangAssetUrls()).toEqual({
      scriptUrl: 'vscode-resource:/ui/slang.js',
      wasmUrl: 'vscode-resource:/ui/slang.wasm',
      workerUrl: 'vscode-resource:/ui/worker.js',
      debugTimings: true,
    });
  });

  it('throws a clear error when host metadata is incomplete', () => {
    document.head.innerHTML = '<meta name="shader-studio-slang-script-url" content="script.js">';
    expect(() => getSlangAssetUrls()).toThrow(/missing Slang asset metadata.*wasm/i);
  });
});
```

- [ ] **Step 2: Write failing engine-factory tests**

Create `shader-explorer/src/lib/engineFactory.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  webgl: { kind: 'webgl' },
  webgpu: { kind: 'webgpu' },
  WebGL: vi.fn(),
  WebGPU: vi.fn(),
  assets: vi.fn(() => ({ scriptUrl: 'script', wasmUrl: 'wasm', workerUrl: 'worker' })),
}));

vi.mock('../../../rendering/src/webgl/RenderingEngine', () => ({
  RenderingEngine: mocks.WebGL.mockImplementation(() => mocks.webgl),
}));
vi.mock('../../../rendering/src/webgpu/WebGPURenderingEngine', () => ({
  WebGPURenderingEngine: mocks.WebGPU.mockImplementation(() => mocks.webgpu),
}));
vi.mock('./slangAssets', () => ({ getSlangAssetUrls: mocks.assets }));

import { createEngineForLanguage } from './engineFactory';

describe('createEngineForLanguage', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([undefined, 'glsl' as const])('uses WebGL for %s', language => {
    expect(createEngineForLanguage(language)).toBe(mocks.webgl);
    expect(mocks.WebGL).toHaveBeenCalledOnce();
    expect(mocks.WebGPU).not.toHaveBeenCalled();
  });

  it('uses WebGPU with canonical assets for Slang', () => {
    expect(createEngineForLanguage('slang')).toBe(mocks.webgpu);
    expect(mocks.WebGPU).toHaveBeenCalledWith(mocks.assets.mock.results[0].value);
    expect(mocks.WebGL).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/slangAssets.test.ts src/lib/engineFactory.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement injected asset lookup and engine selection**

Create `shader-explorer/src/lib/slangAssets.ts`:

```ts
import type { SlangAssetUrls } from '../../../rendering/src/webgpu/WebGPURenderingEngine';

function requireMeta(name: string, label: string): string {
  const value = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;
  if (!value) throw new Error(`Missing Slang asset metadata for ${label}`);
  return value;
}

export function getSlangAssetUrls(): SlangAssetUrls {
  return {
    scriptUrl: requireMeta('shader-studio-slang-script-url', 'script'),
    wasmUrl: requireMeta('shader-studio-slang-wasm-url', 'wasm'),
    workerUrl: requireMeta('shader-studio-slang-worker-url', 'worker'),
    debugTimings: true,
  };
}
```

Create `shader-explorer/src/lib/engineFactory.ts`:

```ts
import { RenderingEngine as WebGLRenderingEngine } from '../../../rendering/src/webgl/RenderingEngine';
import { WebGPURenderingEngine } from '../../../rendering/src/webgpu/WebGPURenderingEngine';
import type { RenderingEngine } from '../../../rendering/src/types/RenderingEngine';
import type { ShaderLanguage } from './shaderCodeRequest';
import { getSlangAssetUrls } from './slangAssets';

export function createEngineForLanguage(language: ShaderLanguage | undefined): RenderingEngine {
  return language === 'slang'
    ? new WebGPURenderingEngine(getSlangAssetUrls())
    : new WebGLRenderingEngine();
}
```

- [ ] **Step 5: Run the tests and verify GREEN**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/slangAssets.test.ts src/lib/engineFactory.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add shader-explorer/src/lib/slangAssets.ts shader-explorer/src/lib/slangAssets.test.ts shader-explorer/src/lib/engineFactory.ts shader-explorer/src/lib/engineFactory.test.ts
git commit -m "feat(explorer): select renderer by shader language"
```

---

### Task 6: Route Thumbnail And Hover Rendering Through The Factory

**Files:**
- Modify: `shader-explorer/src/lib/components/ShaderPreview.svelte`
- Modify: `shader-explorer/src/lib/components/ShaderPreview.test.ts`

- [ ] **Step 1: Write failing component tests for Slang thumbnail and hover rendering**

Replace the rendering-package mock in `ShaderPreview.test.ts` with a hoisted factory mock:

```ts
const { mockEngine, createEngineForLanguage } = vi.hoisted(() => ({
  mockEngine: {
    initialize: vi.fn(),
    compileShaderPipeline: vi.fn(),
    render: vi.fn(),
    startRenderLoop: vi.fn(),
    stopRenderLoop: vi.fn(),
    dispose: vi.fn(),
    getShaderLanguage: vi.fn(() => 'glsl'),
  },
  createEngineForLanguage: vi.fn(),
}));

vi.mock('../engineFactory', () => ({ createEngineForLanguage }));
```

In `beforeEach`, return the engine:

```ts
createEngineForLanguage.mockReturnValue(mockEngine);
```

Allow the test API to send language:

```ts
function makeVscodeApi(
  code = 'void mainImage(out vec4 o,vec2 u){o=vec4(1);}',
  language: 'glsl' | 'slang' = 'glsl',
) {
  return {
    postMessage: vi.fn((msg: any) => {
      if (msg.type === 'requestShaderCode') {
        setTimeout(() => window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'shaderCode', path: msg.path, code, config: null, buffers: {}, language },
        })), 0);
      }
    }),
  };
}
```

Add tests:

```ts
it('selects the Slang engine for a Slang thumbnail', async () => {
  const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
  render(ShaderPreview, {
    props: { shader, vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang') },
  });

  await waitFor(() => expect(createEngineForLanguage).toHaveBeenCalledWith('slang'));
  expect(mockEngine.compileShaderPipeline).toHaveBeenCalledWith(
    expect.stringContaining('float4 mainImage'),
    null,
    '/test/shader.slang',
    {},
  );
});

it('selects the Slang engine again for a cached thumbnail hover preview', async () => {
  const shader = makeShader({
    path: '/test/shader.slang',
    name: 'shader.slang',
    cachedThumbnail: 'data:image/png;base64,abc',
  });
  const { container } = render(ShaderPreview, {
    props: { shader, vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang') },
  });

  await fireEvent.mouseEnter(container.querySelector('.shader-preview-container')!);

  await waitFor(() => expect(createEngineForLanguage).toHaveBeenCalledWith('slang'));
  expect(mockEngine.startRenderLoop).toHaveBeenCalled();
});

it('does not request a WebGL context while cleaning up a Slang engine', async () => {
  mockEngine.getShaderLanguage.mockReturnValue('slang');
  const contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const shader = makeShader({ path: '/test/shader.slang', name: 'shader.slang' });
  render(ShaderPreview, {
    props: { shader, vscodeApi: makeVscodeApi('float4 mainImage(float2 c) { return 1; }', 'slang') },
  });

  await waitFor(() => expect(mockEngine.dispose).toHaveBeenCalled());
  expect(contextSpy).not.toHaveBeenCalledWith('webgl2');
});
```

- [ ] **Step 2: Run the component tests and verify RED**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/components/ShaderPreview.test.ts
```

Expected: FAIL because the component still constructs the WebGL class and ignores the response language.

- [ ] **Step 3: Implement language-aware rendering and cleanup**

Update `ShaderPreview.svelte` imports and state:

```ts
import type { RenderingEngine } from '../../../../rendering/src/types/RenderingEngine';
import { createEngineForLanguage } from '../engineFactory';
import type { ShaderLanguage } from '../shaderCodeRequest';

let renderingEngine: RenderingEngine | null = null;
let hoverRenderingEngine: RenderingEngine | null = null;
let shaderLanguage: ShaderLanguage = 'glsl';
```

In `fetchShaderCode()`:

```ts
shaderLanguage = response.language;
```

In `createShaderRenderer()`:

```ts
const engine = createEngineForLanguage(shaderLanguage);
engine.initialize(targetCanvas, true);
```

Change cleanup to depend on the engine contract:

```ts
function cleanupRenderer(engine: RenderingEngine | null, targetCanvas: HTMLCanvasElement | null) {
  if (!engine) return;
  const language = engine.getShaderLanguage();
  engine.stopRenderLoop();
  engine.dispose();
  if (language !== 'glsl' || !targetCanvas) return;
  const gl = targetCanvas.getContext('webgl2');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
}
```

- [ ] **Step 4: Run the component tests and verify GREEN**

Run:

```bash
cd shader-explorer && npx vitest run src/lib/components/ShaderPreview.test.ts
```

Expected: all component tests pass, including the existing loading and hover cases.

- [ ] **Step 5: Commit**

```bash
git add shader-explorer/src/lib/components/ShaderPreview.svelte shader-explorer/src/lib/components/ShaderPreview.test.ts
git commit -m "fix(explorer): render Slang previews with WebGPU"
```

---

### Task 7: Full Verification And Packaged-Asset Audit

**Files:**
- Modify only files required to resolve verification failures caused by Tasks 1-6.

- [ ] **Step 1: Run all Shader Explorer tests**

Run:

```bash
cd shader-explorer && npx vitest run
```

Expected: all Shader Explorer tests pass.

- [ ] **Step 2: Run Shader Explorer type checks**

Run:

```bash
cd shader-explorer && npm run check
```

Expected: `svelte-check found 0 errors and 0 warnings`, followed by a successful Node TypeScript check.

- [ ] **Step 3: Run extension tests and compile checks**

Run:

```bash
npm run compile-tests -w extension
npm test -w extension -- --grep "ShaderExplorerProvider|SlangAssetManifest"
```

Expected: compilation succeeds and all matching extension tests pass.

- [ ] **Step 4: Run rendering regression tests**

Run:

```bash
npm test -w rendering
```

Expected: all rendering tests pass; no rendering behavior was changed.

- [ ] **Step 5: Run required UI checks**

Run:

```bash
cd ui && npx vitest run src/test/viteSlangAssetManifest.test.ts
npm run check
```

Expected: the manifest tests pass and `svelte-check found 0 errors and 0 warnings`.

- [ ] **Step 6: Run ESLint with fixes, then re-run affected tests**

Run from the repository root:

```bash
npx eslint --fix ui/viteSlangAssetManifest.ts ui/src/test/viteSlangAssetManifest.test.ts shader-explorer/src extension/src/app/SlangAssetManifest.ts extension/src/app/ShaderExplorerProvider.ts extension/src/test/app/SlangAssetManifest.test.ts extension/src/test/app/ShaderExplorerProvider.test.ts
cd shader-explorer && npx vitest run
cd ../ui && npx vitest run src/test/viteSlangAssetManifest.test.ts
```

Expected: ESLint exits 0 and both suites pass after formatting.

- [ ] **Step 7: Build and copy both webviews**

Run:

```bash
test -f ui/src/slang/slang-wasm.wasm || cp /Users/calum/Projects/shader-studio-2/ui/src/slang/slang-wasm.wasm ui/src/slang/slang-wasm.wasm
npm run build -w ui
npm run copy-to-extension -w ui
npm run build -w shader-explorer
npm run copy-to-extension -w shader-explorer
```

Expected: all four commands succeed.

- [ ] **Step 8: Prove the package has one WASM and Explorer has no duplicate runtime**

Run:

```bash
find extension/ui-dist extension/shader-explorer-dist -type f -name '*.wasm' -print
find extension/shader-explorer-dist -type f \( -name 'slang-wasm-*' -o -name 'slangCompileWorker-*' \) -print
node -e 'const fs=require("fs"); const wasm=[]; for (const root of ["extension/ui-dist","extension/shader-explorer-dist"]) for (const entry of fs.readdirSync(root,{recursive:true})) if (String(entry).endsWith(".wasm")) wasm.push(`${root}/${entry}`); if (wasm.length!==1) throw new Error(`expected one wasm, got ${wasm.length}: ${wasm}`); console.log(wasm[0]);'
```

Expected: exactly one `.wasm` path under `extension/ui-dist`; the second `find` prints nothing.

- [ ] **Step 9: Inspect the generated Explorer CSP**

Run the focused extension HTML test once more:

```bash
npm test -w extension -- --grep "Webview HTML"
```

Expected: the test proves the generated CSP contains `unsafe-eval`, `wasm-unsafe-eval`, `blob:` scripts, `worker-src`, and `connect-src`.

- [ ] **Step 10: Commit any verification-only adjustments**

If ESLint or verification required tracked adjustments:

```bash
git add ui shader-explorer extension
git commit -m "test(explorer): verify packaged Slang support"
```

If `git status --short` is clean, skip this commit.

---

## Acceptance Checklist

- [ ] Shader Explorer starts without the reported CSP `EvalError`.
- [ ] `.slang` files appear in the same list/search flow as GLSL files.
- [ ] Slang source responses carry `language: "slang"`.
- [ ] Slang thumbnails use the existing WebGPU renderer.
- [ ] Slang hover previews use the existing WebGPU renderer.
- [ ] GLSL thumbnails and hover previews still use WebGL.
- [ ] Existing config, buffers, resource URIs, caching, resizing, and failure-card behavior remain intact.
- [ ] The extension package contains exactly one Slang WASM binary.
- [ ] Shader Explorer loads the canonical Slang runtime assets from `ui-dist`.
- [ ] Shader Explorer's CSP permits the current Slang runtime and worker requirements.
- [ ] All relevant tests, checks, lint, and builds pass.
