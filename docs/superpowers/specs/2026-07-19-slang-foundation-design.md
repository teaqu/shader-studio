# Slang Workspace Foundation Design

**Date:** 2026-07-19

**Status:** Approved for implementation planning

## Objective

Make Slang a first-class workspace language in Shader Studio without breaking existing `.slang` shaders. The first release will establish an explicit language-version contract, native workspace `import` and `#include` resolution, matching Slang language features in VS Code and the in-app Monaco editor, dependency-aware hot reload, and correct cross-file diagnostics.

Reflection-driven resources, native pipeline entry points, compute execution, automatic differentiation workflows, and HLSL compatibility are outside this release and tracked in the companion roadmap.

## Product Contract

The release preserves Shader Studio's existing ShaderToy-style authoring model:

```slang
float4 mainImage(float2 fragCoord)
{
    return float4(fragCoord / iResolution.xy, 0.0, 1.0);
}
```

Shader Studio continues to generate the WebGPU vertex and fragment entry points, ShaderToy uniforms, configured channels, and custom script uniforms. Workspace dependencies may supply helper declarations, types, interfaces, and generic code, but they do not replace the generated pipeline contract.

The same source workspace must produce consistent completion, navigation, diagnostics, and compilation behavior in both VS Code and Monaco. Unsaved editor content takes precedence over disk content everywhere.

## Language-Version Policy

Existing shaders retain legacy behavior. Shader Studio explicitly compiles a root shader as `#language slang legacy` when it has no language directive, rather than relying on the bundled compiler's changing default.

When a root shader starts with an explicit `#language` directive, Shader Studio preserves it as the first meaningful line. A following `module` declaration is also preserved before the generated prelude. The supported explicit values are those supported by the pinned compiler: `legacy`, `2025`, `2026`, and `latest`.

Conceptually, a modern root becomes:

```slang
#language slang 2026
module image;

// Shader Studio generated prelude

import lighting;

// User source, including mainImage

// Shader Studio generated entry points
```

Imported modules and included files remain ordinary workspace files. Each modern primary module owns its own language and module header. Shader Studio does not silently upgrade existing source to a newer language version. `latest` is always an explicit user choice.

The bundled Slang compiler version is declared in one source of truth and covered by a test that reads the actual WASM version. Compiler upgrades require an intentional compatibility change, release note, and fixture run.

## Architecture

### Shared Slang language-service package

Add a platform-neutral package named `@shader-studio/slang-language-service` that wraps the bundled Slang WASM API. It must not depend on VS Code or Monaco types.

The package exposes plain TypeScript data and owns all Embind objects:

```ts
interface SlangWorkspace {
  openDocument(document: SlangDocumentSnapshot): Promise<void>;
  changeDocument(change: SlangDocumentChange): Promise<void>;
  closeDocument(uri: string): Promise<void>;
  replaceFiles(snapshot: SlangWorkspaceSnapshot): Promise<void>;

  diagnostics(uri: string): Promise<SlangDiagnostic[]>;
  completion(uri: string, position: SlangPosition, context: SlangCompletionContext): Promise<SlangCompletion[]>;
  resolveCompletion(item: SlangCompletion): Promise<SlangCompletion>;
  hover(uri: string, position: SlangPosition): Promise<SlangHover | null>;
  definition(uri: string, position: SlangPosition): Promise<SlangLocation[]>;
  signatureHelp(uri: string, position: SlangPosition): Promise<SlangSignatureHelp | null>;
  documentSymbols(uri: string): Promise<SlangDocumentSymbol[]>;
}
```

Semantic tokens are not part of the initial public contract until the bundled binding exposes or pins the exact token legend. Guessing a legend risks incorrect highlighting. Phase 1 instead replaces the current GLSL fallback with a real Slang TextMate grammar for VS Code and a matching Slang tokenizer for Monaco. The two lexical definitions cover the same pinned keyword, type, attribute, preprocessor, comment, string, and numeric-literal contract and have manifest/tokenization tests.

### Runtime hosts

The shared adapter runs in three isolated hosts:

1. A browser worker serving Monaco.
2. A Node `worker_threads` worker serving VS Code.
3. The existing compilation worker and its main-thread fallback.

Each host owns one WASM module and one virtual filesystem. Sharing one live instance across the extension host and webview is deliberately avoided: it would couple browser/editor latency to transport availability and would not work in standalone web or Electron environments.

The shared request protocol uses serializable request/response messages with request IDs, document versions, structured results, and structured errors. A diagnostics notification includes the URI and document version that produced it. Mutations and queries are serialized within each worker because the language server is synchronous and stateful.

### Canonical paths

Editor URIs are mapped to canonical internal POSIX paths such as `/workspace/lib/palette.slang`. The core owns a bidirectional URI/path map. It normalizes separators and relative segments so `./lib/palette.slang`, `lib/palette.slang`, and an editor URI identify one document and one Monaco model.

Raw `file://` URIs are not passed directly into Slang because the bundled WASM reports more reliable locations for internal absolute paths. Results are mapped back to host URIs before leaving the shared package.

### Workspace snapshots and dependency graph

The extension owns discovery of workspace source files and sends a structured snapshot rather than only a root `code` string and pass-name-keyed `buffers`:

```ts
interface SlangWorkspaceFile {
  uri: string;
  path: string;
  source: string;
  version?: number;
}

interface SlangWorkspaceSnapshot {
  rootUri: string;
  files: SlangWorkspaceFile[];
}
```

Open VS Code documents override disk files in the snapshot. The dependency coordinator records forward and reverse edges for `import`, `__include`, and `#include`. It uses the graph to identify active root shaders and configured passes affected by a dependency change.

Dependency extraction is a cache/invalidation aid, not a replacement compiler. Slang remains authoritative for actual resolution and diagnostics. The implementation must account for comments, strings, relative paths, identifier-form imports, and conditional preprocessor branches conservatively. When dependency extraction is uncertain, it recompiles a broader owning set rather than risking a stale shader.

### Compilation

Before loading a root module, the compiler host mirrors the snapshot into the WASM filesystem. Both worker and main-thread fallback use the same filesystem synchronization logic.

The compile request identifies the real root path and pass path. Diagnostics retain the originating dependency path instead of being flattened into a pass-prefixed string. The existing generated prelude, pass graph, last-good-frame behavior, and WGSL cache remain in place.

The cache key includes the root source, generated options, explicit language header, and every dependency content hash that can affect the pass. A dependency edit must never reuse stale WGSL.

### VS Code integration

The extension adds a Slang language-service coordinator that:

- Loads the packaged Slang JS and WASM assets in a Node worker.
- Synchronizes open, changed, saved, and closed `.slang` documents.
- Registers hover, definition, completion, completion resolution, signature help, and document-symbol providers.
- Publishes language-service diagnostics through a dedicated `shader-studio-slang` diagnostic collection.
- Keeps compile diagnostics in the existing collection so language-service updates cannot erase renderer errors.
- Disposes providers, documents, pending requests, and the worker through the extension lifecycle.

The existing `slang` language ID remains stable to avoid breaking snippets and user configuration. Shader Studio adds an enable setting so users running another Slang extension can disable duplicate language providers.

The `slang` language contribution uses the new Slang TextMate grammar rather than `source.glsl`. The language configuration continues to share only behavior that is genuinely common, such as braces and line comments; Slang-specific word patterns and indentation rules live in a dedicated configuration.

### Monaco integration

The in-app editor creates explicit URI-backed models with language ID `slang` for Slang sources. It no longer labels all models and markers as GLSL.

The Monaco adapter registers hover, definition, completion, completion resolution, signature help, document symbols, and diagnostics. It converts Monaco's one-based positions and ranges to the shared zero-based contract. Language-service markers use a distinct owner from renderer/compiler markers so either source can update independently.

Monaco registers a dedicated Slang tokenizer that mirrors the VS Code grammar's language contract. GLSL setup remains unchanged for GLSL models.

Opening a definition in a dependency creates or selects the one canonical dependency model. Closing a dependency releases its model and language-service document state. Standalone web and Electron hosts use the same browser worker adapter with whatever workspace snapshot their transport can provide.

## Hot Reload and Ownership

An imported helper without `mainImage` is a dependency, not an invalid root shader. Editing it must not trigger the current `Missing mainImage function` error.

On a document change:

1. Update the document snapshot and virtual filesystem.
2. Update conservative dependency edges.
3. Determine affected active roots and passes from reverse dependencies.
4. Respect the current hot, save, or manual compile mode.
5. Compile affected passes in a single generation.
6. Install new pipelines only if the generation succeeds.
7. Keep the last good pipelines when dependency compilation fails.
8. Publish or clear diagnostics on their real source URIs.

An edit shared by Image and BufferA recompiles both. An include used only by BufferB recompiles BufferB and downstream consumers whose pipeline/cache inputs depend on it. Saving source that was already hot-reloaded must not produce duplicate stale generations.

## Diagnostics and Failure Handling

All language-service and compile diagnostics use structured fields:

```ts
interface SlangDiagnostic {
  uri: string;
  range: SlangRange;
  severity: "error" | "warning" | "information" | "hint";
  code?: string;
  message: string;
  source: "slang-language" | "slang-compile" | "webgpu";
  passName?: string;
}
```

Generated prelude diagnostics remain distinguishable from user-file diagnostics. User diagnostics must report real user line numbers. Imported-file diagnostics attach to the dependency URI and may include the owning pass as secondary context.

Worker crashes reject pending calls, recreate the WASM service, remount the current snapshot, and reopen live documents. Host adapters discard responses whose document version no longer matches. All returned or created Embind handles are deep-copied to plain data and deleted in `finally` blocks, including nested result lists.

Missing dependency files produce diagnostics at the import/include site. Fixing, undoing, creating, closing, or reopening a dependency clears stale diagnostics without requiring the preview panel to reopen.

## Testing Strategy

Every behavioral slice follows test-first development.

### Shared package

- Header extraction and explicit legacy fallback.
- Modern language/module header preservation.
- URI/path canonicalization.
- Full and incremental document changes.
- Filesystem create, update, and delete.
- Undefined versus empty language-server results.
- Deep deletion of every Embind result, including exception paths.
- Worker ordering, stale response suppression, restart, remount, and disposal.
- One real bundled-WASM smoke test for open/change/query/close and native import/include resolution.

### Rendering

- Native import and relative include compilation.
- Worker and main-thread fallback parity.
- Root and dependency diagnostic paths/ranges.
- Dependency-sensitive WGSL cache keys.
- Multipass dependency invalidation.
- Last-good-frame behavior after a dependency error.
- Debug and variable-capture compilation with dependencies.

### Extension

- Provider registration for the `slang` selector only.
- Slang grammar and language-configuration manifest coverage.
- Open/change/save/close synchronization with unsaved precedence.
- Imported helpers are not treated as root shaders.
- Reverse dependency recompilation in hot, save, and manual modes.
- Definition and diagnostic URI conversion.
- Diagnostic collection isolation.
- Asset packaging tests for the Slang JS and WASM files.
- Provider and worker cleanup on deactivation.

### Monaco/UI

- URI-backed Slang model creation and reuse.
- Slang tokenizer coverage for language-specific keywords, attributes, module syntax, and preprocessor directives.
- Provider registration and disposal.
- One-based/zero-based conversion.
- Definition navigation into unopened dependencies.
- Separate language-service and renderer marker owners.
- Stale result suppression and cancellation.
- Worker restart and document reopen.
- Existing GLSL overlay behavior remains unchanged.

### Required repository verification

- Relevant focused Vitest and extension test commands during each slice.
- Full UI Vitest suite.
- Full rendering and extension test suites.
- `npx eslint --fix` followed by a clean ESLint run.
- `cd ui && npm run check` with zero errors and warnings.
- Package/build checks needed to verify both worker bundles and copied WASM assets.

## Manual Fixture Workspace

The manual fixture is located at `/Users/calum/Projects/slang-multipass-test`. It is not a Git repository, so implementation must not clean up or rewrite existing files. A single assigned fixture owner adds only a new `foundation/` subtree and treats every existing file as user-owned.

The subtree contains:

- Explicit `legacy`, `2025`, `2026`, and `latest` language-version cases.
- An isolated native-module import case.
- An isolated relative-include case.
- A combined multipass workspace with shared imports and pass-local includes.
- A manual checklist for VS Code and Monaco completion, navigation, diagnostics, unsaved changes, selective recompilation, last-good-frame behavior, save/undo, close/reopen, and resize.

Fixtures are added incrementally when their implementation stream is integrated, allowing manual testing before the whole release finishes.

## Parallel Worktree Execution

The repository supports three implementation subagents at once while the root agent coordinates and reviews.

### Wave 0: shared foundation

One worktree establishes the package, DTO/RPC contract, version policy, path model, virtual filesystem ownership, and exhaustive core tests. No host implementation begins until these contracts are stable.

### Wave 1: three parallel worktrees

1. Native compilation, worker filesystem, diagnostics, and cache correctness.
2. VS Code worker host and language providers.
3. Monaco worker host, models, and language providers.

### Wave 2: three parallel owners

1. Dependency-aware extension reload and diagnostic convergence.
2. Cross-file debugger and integration regression coverage.
3. Manual `foundation/` fixture population and checklist verification.

### Wave 3: integration

Merge/rebase review, conflict resolution, complete verification, and manual fixture walkthrough occur serially. The current uncommitted rendering and capture changes are user-owned; native compiler and debugger worktrees must start from or rebase onto a commit containing them before editing overlapping files.

Expected elapsed effort is 9–12 engineering days with parallel worktrees, compared with approximately 15–21 days sequentially.

## Completion Criteria

Phase 1 is complete when:

- Existing legacy `.slang` shaders compile unchanged.
- Explicit modern language headers compile with correct generated-source ordering.
- Native imports and includes work in image and buffer passes.
- Unsaved dependency edits affect compilation and both language-service surfaces.
- VS Code and Monaco provide matching core language features.
- VS Code and Monaco use Slang-specific lexical highlighting rather than the GLSL grammar.
- Cross-file diagnostics and definition locations target canonical source URIs.
- Dependency edits recompile the correct active passes without `mainImage` false errors.
- Failed dependency compilation preserves the last good frame.
- Debug and variable-capture regressions are covered.
- Automated verification passes.
- The `foundation/` manual fixture checklist passes.
