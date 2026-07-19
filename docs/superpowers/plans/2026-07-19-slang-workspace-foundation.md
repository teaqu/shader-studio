# Slang Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.slang` a first-class workspace language with explicit version behavior, native imports/includes, matching VS Code and Monaco tooling, dependency-aware recompilation, and cross-file diagnostics.

**Architecture:** A new environment-neutral `@shader-studio/slang-language-service` package owns Slang WASM filesystem and language-server interaction behind plain DTOs and an RPC protocol. Separate Node, browser, and compiler workers host that core, while the extension owns workspace snapshots/dependency invalidation and both editor surfaces adapt the same zero-based results.

**Tech Stack:** TypeScript, Slang WASM 2026.10.2, Emscripten MEMFS/Embind, VS Code extension APIs, Monaco, Web Workers, Node worker threads, Svelte 5, Vitest, ESLint.

---

## Execution topology and workspace safety

The current main worktree contains user-owned staged/untracked work. Before executing this plan, commit that work on its intended branch. Never create implementation worktrees from a base that omits those changes, and never edit the shared dirty worktree.

Use these waves:

1. Wave 0: Task 1 and Task 2 in `feat/slang-workspace-core`.
2. Contract checkpoint: merge Wave 0 and Task 3 types into the execution base.
3. Wave 1, three parallel worktrees: Task 4 (`feat/slang-native-modules`), Task 5 (`feat/slang-vscode-language-service`), and Task 6 (`feat/slang-monaco-language-service`).
4. Wave 2, three parallel owners: Task 7 (`feat/slang-dependency-reload`), Task 8 (`feat/slang-cross-file-debugging`), and Task 9 (the external manual fixture).
5. Wave 3: Task 10 integration and verification serially.

At each merge checkpoint, rebase pending worktrees onto the integrated base and rerun their focused tests. The root agent reviews every task for spec compliance and test quality before merging.

## File map

### New shared package

- `slang-language-service/src/types.ts` — serializable DTOs and RPC messages.
- `slang-language-service/src/version.ts` — pinned compiler and generated-source language versions.
- `slang-language-service/src/languageHeader.ts` — root language/module header extraction and legacy fallback.
- `slang-language-service/src/canonicalPaths.ts` — editor URI to MEMFS path mapping.
- `slang-language-service/src/virtualFileSystem.ts` — snapshot/open-document synchronization.
- `slang-language-service/src/embind.ts` — handle ownership and deep-copy helpers.
- `slang-language-service/src/SlangWorkspace.ts` — stateful language-server facade.
- `slang-language-service/src/WorkerClient.ts` — ordered RPC, version rejection, restart/reopen.
- `slang-language-service/src/index.ts` — public exports.
- `slang-language-service/src/test/*` — unit and real-WASM integration tests.

### Shared transport and extension workspace

- `types/src/MessageTypes.ts` — workspace snapshots and structured Slang diagnostics on shader messages.
- `types/src/index.ts` — exports.
- `extension/src/app/SlangWorkspaceSnapshotBuilder.ts` — disk/open-document snapshot construction.
- `extension/src/app/SlangDependencyGraph.ts` — conservative forward/reverse dependency graph.
- `extension/src/app/CompileController.ts` — dependency-aware root recompilation.
- `extension/src/app/ShaderProvider.ts` — send snapshots and stop treating helpers as invalid roots.
- `extension/src/app/ErrorHandler.ts` — source-URI structured compile diagnostics.

### Compilation

- `rendering/src/webgpu/slangTypes.ts` — MEMFS and structured diagnostic subset.
- `rendering/src/webgpu/SlangCompiler.ts` — header-preserving root compilation from workspace snapshots.
- `rendering/src/webgpu/AsyncSlangCompiler.ts` — snapshot-aware worker RPC.
- `rendering/src/webgpu/slangCompileWorker.ts` — mount snapshot before compile.
- `rendering/src/webgpu/SlangPrelude.ts` — insert generated prelude after language/module header.
- `rendering/src/webgpu/SlangWgslCache.ts` — dependency-sensitive keys.
- `rendering/src/webgpu/WebGPURenderingEngine.ts` — pass paths/snapshots and structured errors.

### VS Code tooling

- `extension/src/language/slangLanguageWorker.ts` — Node worker host.
- `extension/src/language/SlangLanguageClient.ts` — extension-side RPC and restart lifecycle.
- `extension/src/language/registerSlangLanguageFeatures.ts` — providers and diagnostics.
- `extension/syntaxes/slang.tmLanguage.json` — real Slang grammar.
- `extension/slang-language-configuration.json` — Slang comments/brackets/word rules.
- `extension/package.json`, `extension/esbuild.js` — contributions, enable setting, worker/assets.

### Monaco tooling

- `monaco/src/slang-language.ts` — matching Slang tokenizer.
- `monaco/src/slang/SlangMonacoAdapter.ts` — providers, models, diagnostics.
- `monaco/src/setup.ts`, `monaco/src/index.ts` — Slang setup exports.
- `ui/src/lib/slangLanguageWorker.ts` — browser worker host.
- `ui/src/lib/components/EditorOverlay.svelte` — URI-backed language-specific models.

### Manual fixture

- `/Users/calum/Projects/slang-multipass-test/foundation/**` — additive manual fixtures only.

---

### Task 1: Establish the shared package, version policy, paths, and MEMFS synchronization

**Files:**
- Create/complete: `slang-language-service/package.json`
- Create/complete: `slang-language-service/tsconfig.json`
- Create: `slang-language-service/src/types.ts`
- Create: `slang-language-service/src/version.ts`
- Create: `slang-language-service/src/languageHeader.ts`
- Create: `slang-language-service/src/canonicalPaths.ts`
- Create: `slang-language-service/src/virtualFileSystem.ts`
- Create: `slang-language-service/src/index.ts`
- Test: `slang-language-service/src/test/languageHeader.test.ts`
- Test: `slang-language-service/src/test/canonicalPaths.test.ts`
- Test: `slang-language-service/src/test/virtualFileSystem.test.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

> A partial uncommitted scaffold for these files exists in the shared workspace. Preserve it, review it against this task, and either commit it as the Wave 0 starting point or reconcile it in the isolated worktree. Do not overwrite it from another worktree.

- [ ] **Step 1: Run the existing foundation tests and confirm the missing implementation failure**

Run:

```bash
npm test -w @shader-studio/slang-language-service
```

Expected: FAIL because `languageHeader`, `canonicalPaths`, `types`, and `virtualFileSystem` are not implemented.

- [ ] **Step 2: Define the serializable workspace types**

Create `slang-language-service/src/types.ts` with:

```ts
export type SlangLanguageVersion = "legacy" | "2025" | "2026" | "latest";

export interface SlangPosition { line: number; character: number }
export interface SlangRange { start: SlangPosition; end: SlangPosition }

export interface SlangWorkspaceFile {
  uri: string;
  path: string;
  source: string;
  version?: number;
}

export interface SlangWorkspaceSnapshot {
  rootUri: string;
  files: SlangWorkspaceFile[];
}

export interface SlangDocumentSnapshot {
  uri: string;
  path: string;
  source: string;
  version: number;
}

export interface SlangDiagnostic {
  uri: string;
  range: SlangRange;
  severity: "error" | "warning" | "information" | "hint";
  code?: string;
  message: string;
  source: "slang-language" | "slang-compile" | "webgpu";
  passName?: string;
}
```

Create `version.ts` with an intentionally reviewed compiler pin and a non-`latest` new-file default:

```ts
export const PINNED_SLANG_COMPILER_VERSION = "2026.10.2";
export const NEW_SLANG_FILE_LANGUAGE_VERSION = "2026" as const;
```

- [ ] **Step 3: Implement header extraction with legacy fallback**

Implement `splitSlangRootHeader(source)` so it:

- recognizes a leading directive after whitespace/comments;
- preserves original newlines and line placeholders;
- extracts a following `module ...;` declaration;
- injects `#language slang legacy` only in the generated compile header when absent;
- reports unsupported explicit versions without changing them.

Export:

```ts
export const SUPPORTED_SLANG_LANGUAGE_VERSIONS = ["legacy", "2025", "2026", "latest"] as const;

export interface SlangRootHeader {
  header: string;
  body: string;
  language: string;
  diagnostics: Array<{ line: number; message: string }>;
}
```

- [ ] **Step 4: Implement canonical paths and MEMFS synchronization**

Implement `SlangPathMap` with `/workspace` as the only allowed internal root. Reject traversal and duplicate canonical mappings. Implement:

```ts
export interface SlangFileSystem {
  mkdirTree(path: string): void;
  writeFile(path: string, source: string): void;
  unlink(path: string): void;
  analyzePath(path: string): { exists: boolean };
}

export function syncWorkspaceToFileSystem(
  fs: SlangFileSystem,
  snapshot: SlangWorkspaceSnapshot,
  openDocuments?: ReadonlyMap<string, { source: string; version: number }>,
  ownedPaths?: Set<string>,
): Set<string>;
```

The returned/set state contains only paths owned by this workspace and is the only set eligible for deletion.

- [ ] **Step 5: Run package tests and build**

Run:

```bash
npm test -w @shader-studio/slang-language-service
npm run build -w @shader-studio/slang-language-service
```

Expected: all shared package tests PASS and TypeScript emits `dist` without diagnostics.

- [ ] **Step 6: Commit the shared primitives**

```bash
git add package.json vitest.config.ts slang-language-service
git commit -m "feat(slang): add workspace language primitives"
```

---

### Task 2: Wrap the Embind language server and add resilient RPC

**Files:**
- Create: `slang-language-service/src/slangApi.ts`
- Create: `slang-language-service/src/embind.ts`
- Create: `slang-language-service/src/SlangWorkspace.ts`
- Create: `slang-language-service/src/workerProtocol.ts`
- Create: `slang-language-service/src/WorkerClient.ts`
- Modify: `slang-language-service/src/index.ts`
- Test: `slang-language-service/src/test/SlangWorkspace.test.ts`
- Test: `slang-language-service/src/test/WorkerClient.test.ts`
- Test: `slang-language-service/src/test/realWasm.test.ts`

- [ ] **Step 1: Write fake-Embind tests first**

Cover open/change/close ordering, zero-based result fidelity, `undefined` versus empty results, path mapping, document-version rejection, recursive document-symbol copying, nested signature parameters, and `.delete()` calls on success and exception paths.

The fake handle helper should expose:

```ts
function fakeList<T>(items: T[]) {
  return {
    size: () => items.length,
    get: (index: number) => items[index],
    delete: vi.fn(),
  };
}
```

Run:

```bash
npm test -w @shader-studio/slang-language-service -- SlangWorkspace.test.ts WorkerClient.test.ts
```

Expected: FAIL because the facade/client do not exist.

- [ ] **Step 2: Define the narrow Slang WASM interface**

In `slangApi.ts`, define only the methods used by the core: `FS`, `createLanguageServer`, document lifecycle, hover, definition, completion, completion resolution, signature help, symbols, diagnostics, and their vector-like handles. Every handle type extends `{ delete(): void }`.

- [ ] **Step 3: Implement `SlangWorkspace`**

The class owns one path map, one language server, current open-document versions, and owned MEMFS paths. Public methods return plain DTOs only. Use `try/finally` around every Embind handle:

```ts
function copyList<T, R>(handle: SlangList<T> | undefined, copy: (value: T) => R): R[] {
  if (!handle) return [];
  try {
    const result: R[] = [];
    for (let index = 0; index < handle.size(); index++) {
      const value = handle.get(index);
      if (value !== undefined) result.push(copy(value));
    }
    return result;
  } finally {
    handle.delete();
  }
}
```

Do not expose semantic tokens until a token legend is pinned.

- [ ] **Step 4: Implement RPC and restart behavior**

Define discriminated requests for `init`, `replaceFiles`, document mutations, and language queries. `WorkerClient` must serialize mutations, allow queries only after preceding mutations, reject pending requests on crash, recreate the worker, replay the latest workspace snapshot/open documents, and drop results whose response version differs from the caller's current version.

- [ ] **Step 5: Add a real bundled-WASM smoke test**

Load `ui/src/slang/slang-wasm.js` and `.wasm`, mount `/workspace/palette.slang`, open a root importing `palette`, and assert diagnostics/completion/definition return without throwing. Assert `getVersionString()` equals the pinned version constant.

- [ ] **Step 6: Verify and commit**

```bash
npm test -w @shader-studio/slang-language-service
npm run build -w @shader-studio/slang-language-service
git add slang-language-service
git commit -m "feat(slang): wrap workspace language server"
```

Expected: tests and build PASS.

---

### Task 3: Add shared workspace transport and conservative dependency indexing

**Files:**
- Modify: `types/src/MessageTypes.ts`
- Modify: `types/src/index.ts`
- Create: `extension/src/app/SlangDependencyGraph.ts`
- Create: `extension/src/app/SlangWorkspaceSnapshotBuilder.ts`
- Test: `types/src/test/MessageTypes.test.ts`
- Test: `extension/src/test/app/SlangDependencyGraph.test.ts`
- Test: `extension/src/test/app/SlangWorkspaceSnapshotBuilder.test.ts`

- [ ] **Step 1: Write failing graph and snapshot tests**

Test identifier imports, string imports, `#include`, `__include`, relative normalization, comments/strings ignored, cycles, one dependency owned by multiple roots, transitive reverse dependants, deleted files, and unsaved VS Code documents overriding disk.

Run:

```bash
npx vitest run types/src/test/MessageTypes.test.ts
npm run compile-tests -w extension
```

Expected: FAIL because snapshot types/builders do not exist.

- [ ] **Step 2: Extend the shader message contract**

Add to `ShaderSourceMessage`:

```ts
workspace?: {
  rootUri: string;
  files: Array<{
    uri: string;
    path: string;
    source: string;
    version?: number;
  }>;
};
diagnostics?: Array<{
  uri: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity: "error" | "warning" | "information" | "hint";
  code?: string;
  message: string;
  source: "slang-language" | "slang-compile" | "webgpu";
  passName?: string;
}>;
```

Keep fields optional so older web clients and GLSL messages remain compatible.

- [ ] **Step 3: Implement the dependency graph**

Expose:

```ts
export class SlangDependencyGraph {
  update(uri: string, source: string): void;
  remove(uri: string): void;
  directDependencies(uri: string): ReadonlySet<string>;
  affectedRoots(uri: string, activeRoots: ReadonlySet<string>): ReadonlySet<string>;
}
```

Resolve ambiguous extraction conservatively: add all plausible normalized candidates and broaden recompilation rather than omitting an owner.

- [ ] **Step 4: Implement snapshot construction**

The builder gathers `.slang` files under the workspace root, configured pass files, common code, and dependencies. It uses matching open `TextDocument` contents first and disk second. Sort files by canonical path for deterministic messages/cache keys.

- [ ] **Step 5: Verify and commit the contract checkpoint**

```bash
npm run build -w @shader-studio/types
npm run compile-tests -w extension
git add types/src extension/src/app/SlangDependencyGraph.ts extension/src/app/SlangWorkspaceSnapshotBuilder.ts extension/src/test
git commit -m "feat(slang): add workspace dependency contract"
```

Expected: types build and extension tests compile/pass.

---

### Task 4: Compile native imports/includes in worker and fallback paths

**Parallel wave:** Wave 1A after Tasks 1–3.

**Files:**
- Modify: `rendering/src/webgpu/slangTypes.ts`
- Modify: `rendering/src/webgpu/SlangCompiler.ts`
- Modify: `rendering/src/webgpu/SlangPrelude.ts`
- Modify: `rendering/src/webgpu/AsyncSlangCompiler.ts`
- Modify: `rendering/src/webgpu/slangCompileWorker.ts`
- Modify: `rendering/src/webgpu/SlangWgslCache.ts`
- Modify: `rendering/src/webgpu/WebGPURenderingEngine.ts`
- Test: `rendering/src/test/webgpu/SlangCompiler.test.ts`
- Test: `rendering/src/test/webgpu/AsyncSlangCompiler.test.ts`
- Test: `rendering/src/test/webgpu/WebGPURenderingEngine.test.ts`

- [ ] **Step 1: Add failing compiler tests**

Add tests asserting:

- generated prelude follows `#language` and `module`;
- directive-free roots receive legacy header internally;
- import/include dependencies are mounted before module load;
- real root/dependency paths appear in diagnostics;
- worker and main-thread fallback receive identical snapshots;
- changing dependency content changes the WGSL cache key;
- failure preserves existing pipelines.

Run:

```bash
npm test -w @shader-studio/rendering -- SlangCompiler.test.ts AsyncSlangCompiler.test.ts WebGPURenderingEngine.test.ts
```

Expected: new tests FAIL.

- [ ] **Step 2: Change the async compile contract**

Use one request object:

```ts
export interface SlangCompileRequest {
  source: string;
  sourceUri: string;
  sourcePath: string;
  workspace: SlangWorkspaceSnapshot;
  options: SlangCompileOptions;
}

export interface AsyncSlangCompiler {
  compile(request: SlangCompileRequest): Promise<SlangCompileResult>;
  dispose(): void;
}
```

Update worker messages and fallback calls together; do not maintain two compile signatures.

- [ ] **Step 3: Mount the snapshot and preserve the source header**

Inject the shared filesystem/header helpers into `SlangCompiler`. Load the wrapped module using `sourcePath`, not `/${pass}.slang`. Build wrapped source as `header + generated prelude + body + generated entry points` while preserving blank source lines used by diagnostics.

- [ ] **Step 4: Return structured diagnostics**

Change failure results from `errors: string[]` to include structured diagnostics while temporarily retaining formatted `errors` for existing consumers:

```ts
export type SlangCompileResult =
  | { success: true; wgsl: string; diagnostics: SlangDiagnostic[] }
  | { success: false; errors: string[]; diagnostics: SlangDiagnostic[] };
```

Parse only Slang's stable file/line/column envelope; preserve the raw message when parsing fails.

- [ ] **Step 5: Make cache keys dependency-sensitive**

Hash the sorted tuple of canonical path plus source for every file in the request snapshot together with pass options. A dependency edit must miss the cache even when the root source is unchanged.

- [ ] **Step 6: Verify and commit**

```bash
npm test -w @shader-studio/rendering
npm run build -w @shader-studio/rendering
git add rendering/src
git commit -m "feat(rendering): compile Slang workspace modules"
```

Expected: rendering tests/build PASS.

---

### Task 5: Add VS Code Slang grammar and language features

**Parallel wave:** Wave 1B after Tasks 1–3.

**Files:**
- Create: `extension/src/language/slangLanguageWorker.ts`
- Create: `extension/src/language/SlangLanguageClient.ts`
- Create: `extension/src/language/registerSlangLanguageFeatures.ts`
- Create: `extension/syntaxes/slang.tmLanguage.json`
- Create: `extension/slang-language-configuration.json`
- Modify: `extension/src/extension.ts`
- Modify: `extension/src/app/ShaderCreator.ts`
- Modify: `extension/package.json`
- Modify: `extension/esbuild.js`
- Test: `extension/src/test/language/SlangLanguageClient.test.ts`
- Test: `extension/src/test/language/registerSlangLanguageFeatures.test.ts`
- Test: `extension/src/test/slang-language-assets.test.ts`
- Test: `extension/src/test/app/ShaderCreator.test.ts`

- [ ] **Step 1: Write failing provider, lifecycle, and manifest tests**

Test `slang`-only selectors, 0-based/VS Code conversions, dedicated diagnostic collection, open/change/close forwarding, stale result rejection, crash/restart/reopen, disable setting, provider disposal, and packaged JS/WASM/worker assets. Assert the manifest no longer maps Slang to `source.glsl`.

- [ ] **Step 2: Add a real Slang lexical grammar**

Cover module/import/implementing, `__include`, interface/generic keywords, shader attributes, HLSL-derived types, preprocessor directives, comments, strings, and numeric literals. Use scope `source.slang`. Add a dedicated language configuration for comments, brackets, autoclosing pairs, and word pattern.

- [ ] **Step 3: Build the Node worker and client**

The worker loads packaged Slang JS/WASM and the shared workspace core. The client implements the shared RPC, restarts once after failure, and replays the latest snapshot/open documents. Extension build code copies assets into deterministic `dist/slang/` paths.

- [ ] **Step 4: Register providers and isolated diagnostics**

Register completion/resolve, hover, definition, signature help, and symbols. Use:

```ts
const selector: vscode.DocumentSelector = [{ language: "slang", scheme: "file" }];
const diagnostics = vscode.languages.createDiagnosticCollection("shader-studio-slang");
```

Do not clear or reuse the renderer's `shader-studio` collection. Put all disposables in `context.subscriptions`.

- [ ] **Step 5: Generate modern headers only for newly created `.slang` files**

Add a Slang filter to the save dialog and select the template from the chosen extension:

```ts
private getShaderTemplate(filePath: string): string {
  if (filePath.toLowerCase().endsWith(".slang")) {
    const basename = path.basename(filePath, path.extname(filePath))
      .replace(/[^a-zA-Z0-9_]/g, "_");
    const moduleName = /^[0-9]/.test(basename) ? `_${basename}` : basename;
    return `#language slang ${NEW_SLANG_FILE_LANGUAGE_VERSION}
module ${moduleName};

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    return float4(uv, 0.0, 1.0);
}`;
  }
  return this.getGlslShaderTemplate();
}
```

Keep `shadertoy.glsl` as the default filename for backward compatibility. Tests must prove a user-selected `.slang` path receives the modern header while `.glsl` output is byte-for-byte unchanged.

- [ ] **Step 6: Verify and commit**

```bash
npm run compile-tests -w extension
npm run lint -w extension
npm run build:code -w extension
git add extension
git commit -m "feat(extension): add Slang language features"
```

Expected: extension tests, lint, and code build PASS; packaged asset test finds worker, JS, and WASM.

---

### Task 6: Add Monaco Slang models, tokenizer, and language features

**Parallel wave:** Wave 1C after Tasks 1–3.

**Files:**
- Create: `monaco/src/slang-language.ts`
- Create: `monaco/src/slang/SlangMonacoAdapter.ts`
- Modify: `monaco/src/setup.ts`
- Modify: `monaco/src/index.ts`
- Create: `ui/src/lib/slangLanguageWorker.ts`
- Modify: `ui/src/lib/components/EditorOverlay.svelte`
- Test: `monaco/src/test/slang-language.test.ts`
- Test: `monaco/src/test/SlangMonacoAdapter.test.ts`
- Test: `ui/src/test/components/EditorOverlay.test.ts`

- [ ] **Step 1: Write failing tokenizer and adapter tests**

Assert matching Slang keyword/type/attribute/preprocessor tokens, provider registration exactly once, model URI canonicalization, one-based/zero-based conversion, definition navigation, dependency model reuse, separate marker owners, stale version rejection, and disposal.

- [ ] **Step 2: Register the Slang language independently of GLSL**

Add `setupMonacoSlang(monaco, client)` that registers language ID `slang`, its Monarch tokenizer, and provider adapter. Keep `setupMonacoGlsl` unchanged for GLSL.

- [ ] **Step 3: Implement the browser worker and adapter**

Use the shared RPC/client contract. Convert Monaco cancellation into response dropping. Set language diagnostics with owner `slang-language` and renderer diagnostics with `slang-compile`; never write Slang markers under `glsl`.

- [ ] **Step 4: Convert the overlay to explicit models**

Replace `value`/`language` construction with:

```ts
const modelUri = monaco.Uri.parse(shaderUri);
const model = monaco.editor.getModel(modelUri)
  ?? monaco.editor.createModel(shaderCode, shaderLanguage, modelUri);
editor = monaco.editor.create(containerEl, { ...editorOptions, model });
```

Choose `shaderLanguage` from the incoming shader message. Save view state per canonical URI. Dispose models only when no overlay/document owns them.

- [ ] **Step 5: Verify and commit**

```bash
npm test -w @shader-studio/monaco
cd ui && npx vitest run src/test/components/EditorOverlay.test.ts
cd ui && npm run check
git add monaco ui/src
git commit -m "feat(ui): add Monaco Slang language features"
```

Expected: Monaco/UI focused tests and full UI check PASS.

---

### Task 7: Make hot reload dependency-aware and converge diagnostics

**Parallel wave:** Wave 2A after Tasks 4–6 contracts are integrated.

**Files:**
- Modify: `extension/src/app/CompileController.ts`
- Modify: `extension/src/app/ShaderProvider.ts`
- Modify: `extension/src/app/ShaderConfigProcessor.ts`
- Modify: `extension/src/app/ErrorHandler.ts`
- Modify: `ui/src/lib/ShaderPipeline.ts`
- Modify: `ui/src/lib/components/ShaderViewer.svelte`
- Test: `extension/src/test/app/CompileController.test.ts`
- Test: `extension/src/test/app/ShaderProvider.test.ts`
- Test: `extension/src/test/app/ErrorHandler.test.ts`
- Test: `ui/src/test/ShaderProcessor.test.ts`

- [ ] **Step 1: Write failing ownership/reload tests**

Cover imported helper edits with no `mainImage`, one dependency affecting multiple active roots/passes, pass-local includes, hot/save/manual modes, unsaved contents, delete/create, cycles, save-after-hot-reload deduplication, and correct diagnostic clearing.

- [ ] **Step 2: Route helper edits through reverse ownership**

Before `trySendNonMainImageShader`, ask the dependency coordinator for active owning roots. A helper with owners schedules those owners and never emits `Missing mainImage`. A standalone file without owners retains the current missing-entry error.

- [ ] **Step 3: Send deterministic workspace snapshots**

`ShaderProvider` attaches the snapshot for Slang root messages only. GLSL messages and existing `buffers` remain unchanged. One compile generation coalesces all affected pass/root requests for the same editor change.

- [ ] **Step 4: Publish structured diagnostics by source URI**

Extension compile errors go to their source documents and retain optional pass context. UI routes dependency diagnostics to canonical Monaco models and leaves renderer markers independent from language-service markers.

- [ ] **Step 5: Verify and commit**

```bash
npm run compile-tests -w extension
cd ui && npx vitest run src/test/ShaderProcessor.test.ts
git add extension/src ui/src types/src
git commit -m "feat(slang): reload dependent shader roots"
```

Expected: focused extension/UI tests PASS.

---

### Task 8: Add cross-file debugger and variable-capture regression coverage

**Parallel wave:** Wave 2B after Task 4.

**Files:**
- Modify: `debug/src/types.ts`
- Modify: `debug/src/ShaderDebugger.ts`
- Modify: `debug/src/VariableCaptureBuilder.ts`
- Modify: `ui/src/lib/ShaderDebugManager.ts`
- Modify: `ui/src/lib/VariableCaptureManager.ts`
- Modify: `rendering/src/webgpu/WebGPUVariableCapturer.ts`
- Test: `debug/src/test/ShaderDebugger.slang.test.ts`
- Test: `debug/src/test/VariableCaptureBuilder.slang.test.ts`
- Test: `ui/src/test/debug/ShaderDebugManager.slang.test.ts`
- Test: `ui/src/test/VariableCaptureManager.slang.test.ts`
- Test: `rendering/src/test/webgpu/WebGPUVariableCapturer.test.ts`

- [ ] **Step 1: Characterize supported and unsupported cross-file debugging first**

Add failing tests for a root `mainImage` calling an imported helper, a common/include helper, dependency compile diagnostics, header line preservation, debug off/on parity, and last-good capture pipeline behavior. If instrumentation inside an imported file is not safe in Phase 1, assert a structured unsupported diagnostic rather than silent wrong output.

- [ ] **Step 2: Carry source identity through debug requests**

Extend debug context with `sourceUri` and workspace snapshot. Instrument only the selected source file, remount all unchanged dependencies, and compile the transformed root/dependency set with the same header/filesystem logic as normal rendering.

- [ ] **Step 3: Preserve generated binding and capture behavior**

Reuse the existing pass name, channel set, custom uniform layout, and capture bindings. Do not introduce a second dependency resolver in the debugger.

- [ ] **Step 4: Verify and commit**

```bash
npm test -w @shader-studio/glsl-debug
npm test -w @shader-studio/rendering -- WebGPUVariableCapturer.test.ts
cd ui && npx vitest run src/test/debug/ShaderDebugManager.slang.test.ts src/test/VariableCaptureManager.slang.test.ts
git add debug rendering/src ui/src
git commit -m "test(slang): cover cross-file shader debugging"
```

Expected: all focused debug/capture tests PASS.

---

### Task 9: Add the additive manual foundation fixture

**Parallel wave:** Wave 2C. This task edits `/Users/calum/Projects/slang-multipass-test`, which is not a Git repository.

**Files:**
- Create: `/Users/calum/Projects/slang-multipass-test/foundation/README.md`
- Create: `/Users/calum/Projects/slang-multipass-test/foundation/versions/**`
- Create: `/Users/calum/Projects/slang-multipass-test/foundation/modules/**`
- Create: `/Users/calum/Projects/slang-multipass-test/foundation/includes/**`
- Create: `/Users/calum/Projects/slang-multipass-test/foundation/workspace/**`

- [ ] **Step 1: Verify the fixture boundary before writing**

Run:

```bash
test -d /Users/calum/Projects/slang-multipass-test
test ! -e /Users/calum/Projects/slang-multipass-test/foundation
```

Expected: both commands succeed. If `foundation/` already exists, stop and inspect it as user-owned work instead of replacing it.

- [ ] **Step 2: Add isolated language-version fixtures**

Create legacy, 2025, 2026, and latest root shaders with minimal Image configs. Legacy has no directive to verify fallback. Modern files begin with explicit language and module headers. Each shader renders a distinct quadrant/color encoding its case.

- [ ] **Step 3: Add native import and include fixtures**

`modules/import-preview.slang` imports `palette.slang`; `includes/include-preview.slang` includes `tone-map.slang`. Both render visibly different output when the dependency constant changes.

- [ ] **Step 4: Add the combined multipass workspace**

Mirror the proven `flow.sha.json` behavior with Image, self-feedback History, half-resolution Glow, a shared imported palette, and a Glow-local blur include. Preserve visible top/left orientation markers and moving feedback.

- [ ] **Step 5: Write the manual acceptance matrix**

Document disk/unsaved edit, error, undo, save, close/reopen, F12/Cmd-click navigation in VS Code and Monaco, selective pass invalidation, resize, and last-good-frame checks. Record expected visual output and diagnostic URI for each case.

- [ ] **Step 6: Do not modify existing fixture files**

Confirm:

```bash
find /Users/calum/Projects/slang-multipass-test/foundation -type f | sort
```

Expected: only the new subtree is listed as work from this task. Because the directory is unversioned, hand the exact file list to the user in the task report.

---

### Task 10: Integrate, verify, document, and prepare release notes

**Files:**
- Modify: `docs/features/code-snippets.md` or create `docs/features/slang-workspaces.md`
- Modify: `docs/help/troubleshooting.md`
- Modify: `mkdocs.yml`
- Modify on release only: `extension/CHANGELOG.md`

- [ ] **Step 1: Merge/rebase the worktrees in dependency order**

Order: Tasks 1–3, Task 4, Tasks 5–6, Task 7, Task 8. Resolve shared-file conflicts by preserving the integrated contracts, not by choosing one branch wholesale. Re-run each branch's focused tests immediately after integration.

- [ ] **Step 2: Add user documentation**

Document:

- implicit legacy behavior;
- explicit `#language`/`module` headers;
- modern header generated for new Slang files;
- source authority and absence of a JSON version setting;
- module/include resolution roots;
- unsaved dependency behavior;
- language-service enable setting and coexistence with other Slang extensions;
- Phase 1 resource/entry-point limitations.

- [ ] **Step 3: Run the complete automated verification**

```bash
npm test -w @shader-studio/slang-language-service
npm test -w @shader-studio/monaco
npm test -w @shader-studio/glsl-debug
npm test -w @shader-studio/rendering
cd ui && npx vitest run
cd ui && npm run check
npm run compile-tests -w extension
npm run build:code -w extension
npx eslint --fix
npx eslint .
```

Expected: every command exits 0; UI check reports zero errors and warnings; ESLint produces no remaining changes/errors.

- [ ] **Step 4: Verify packaged extension assets**

Run the package-level build needed for the extension development host, not the redundant full root release build:

```bash
npm run build:code -w extension
test -f extension/dist/slang/slang-wasm.js
test -f extension/dist/slang/slang-wasm.wasm
test -f extension/dist/slang/slang-language-worker.js
```

Expected: extension build passes and all three files exist.

- [ ] **Step 5: Walk the manual foundation fixture**

Open `/Users/calum/Projects/slang-multipass-test/foundation/README.md` and complete every VS Code and Monaco checklist item. Record any failure before declaring Phase 1 complete.

- [ ] **Step 6: Request code review**

Use `superpowers:requesting-code-review` against the integrated diff. Address findings with `superpowers:receiving-code-review`, rerun affected tests, then repeat the completion verification.

- [ ] **Step 7: Commit documentation and release metadata**

If this work is part of a new extension release, add the version entry to `extension/CHANGELOG.md` before any release tag.

```bash
git add docs mkdocs.yml extension/CHANGELOG.md
git commit -m "docs: document Slang workspace support"
```

If no release is being cut, omit `extension/CHANGELOG.md` from the command and do not create a tag.

---

## Definition of done

- Directive-free existing shaders remain legacy-compatible.
- Newly generated Slang files declare pinned Slang 2026 and a module name.
- Imports/includes compile in worker and fallback paths for Image and buffer passes.
- VS Code and Monaco use Slang-specific lexical highlighting and matching language features.
- Unsaved dependency edits drive diagnostics, navigation, and selective recompilation.
- Helpers are not rejected for lacking `mainImage` when they have active owners.
- Dependency failures preserve the last good frame and clear cleanly after a fix.
- Debug/variable-capture behavior is covered for the supported cross-file contract.
- All automated verification and the additive manual fixture checklist pass.
- The broader roadmap remains separate from this Phase 1 release.
