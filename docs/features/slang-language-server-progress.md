# Slang Language Server Progress

Status: parked for later work. The Shader Studio rendering compiler remains authoritative and can operate without enabling editor language features.

## Resume location

- Branch: `wip/slang-language-server`
- Worktree: `/Users/calum/Projects/shader-studio-2/.worktrees/slang-language-context-fixes`
- Latest implementation commit: `18c6cbc` (`fix(slang): preserve user EOF language results`)
- Base branch when work started: `feat/slang-webgpu-m1` at `747672e`
- Manual fixture: `/Users/calum/Projects/slang-multipass-test/foundation/`

The WIP branch contains these language-context commits after the original workspace-language implementation:

```text
7dc4be2 fix(extension): serialize Slang provider positions
70f141b docs: harden Slang language context boundaries
d6594f3 fix(slang): add entry-file language context
a9dadc7 fix(slang): tighten entry context filtering
6c2e2b2 fix(slang): parse entry declaration context
18c6cbc fix(slang): preserve user EOF language results
```

The design and implementation plan are:

- `docs/superpowers/specs/2026-07-20-slang-language-context-fixes-design.md`
- `docs/superpowers/plans/2026-07-20-slang-language-context-fixes.md`

## Why this work was started

Manual Extension Development Host testing exposed two defects:

1. Position-based VS Code providers logged `Slang language feature error: Error: Missing field: "line"` because a `vscode.Position` instance crossed the Node worker boundary instead of a plain DTO.
2. Valid Shader Studio entry shaders reported `iResolution` as undefined because the language server analyzed raw source without Shader Studio's generated built-ins.

These were language-service defects only. Shader Studio's render compiler continued compiling the actual shader successfully and remained the source of truth for render errors.

## Implemented fixes

### VS Code worker position boundary

Completion, hover, definition, and signature-help providers now convert positions to plain zero-based `{ line, character }` objects before worker RPC.

The regression test reproduced the real runtime shape (`{ _line, _character }`) and proves all four providers send plain objects with `Object.prototype`.

### Entry-only Shader Studio context

The shared language service derives an analysis-only source for active global `float4 mainImage(...)` entry files. It appends typed declarations for stable Shader Studio built-ins, including `iResolution`, `iTime`, `iMouse`, frame/date/camera values, and channel metadata arrays.

The original source remains an exact prefix. Raw bytes remain in MEMFS and are never written back to the user's file. Imported/helper modules remain strict and still report `iResolution` as undefined.

Entry detection currently:

- ignores comments, quoted strings, and preprocessor logical lines;
- rejects calls, member calls, macro wrappers, nested/member/local declarations, and inactive literal conditional branches;
- accepts global declarations with supported modifiers and attributes;
- tracks literal `#if`/`#elif` `0` and `1`, `#else`, nested conditionals, and `#endif`;
- treats unknown conditional expressions conservatively as inactive for context detection.

### Source ownership and coordinates

Open documents track both raw `source` and derived `analysisSource`.

- Slang's language-server overlay receives `analysisSource`.
- MEMFS receives raw `source`.
- Full-document changes replace through the previous analysis EOF, preventing stale generated declarations.
- Path remaps reopen the language-server document with analysis text.
- Closing a document restores the saved raw snapshot.
- A protected blank separator prevents a trailing backslash-continued line comment from swallowing the first generated declaration.

### Generated-result filtering

Only augmented entry documents filter generated results, and only positions strictly after raw EOF. This preserves genuine zero-length diagnostics at user EOF.

- Generated diagnostics are hidden.
- Same-document definitions into the invisible suffix are hidden.
- Generated document symbols are removed recursively; valid descendants are promoted.
- Ordinary unaugmented modules return native diagnostics, definitions, and symbols unchanged.

## Test evidence

Test-first evidence was captured for each bug and review correction:

- Position adapter: failing runtime-shape assertion, then focused VS Code test passing.
- Pure context: final `41/41` passing.
- Workspace lifecycle/filtering: final `32/32` passing.
- Real Slang WASM: final `7/7` passing.
- Complete shared language-service package: final `145/145` passing.
- Shared package CJS and ESM builds passed.
- Scoped TypeScript ESLint and `git diff --check` passed.

Real-WASM coverage includes:

- useful hover information for `float4`, `cos`, and `iResolution`;
- no false `iResolution` diagnostic in a real entry shader;
- diagnostic `30015` retained in strict helper/inactive-entry modules;
- exact document-symbol result containing only `mainImage`;
- no navigation into generated suffix lines;
- suffix validity under `legacy`, `2025`, `2026`, and `latest`;
- reserved-name redeclaration retaining user-area ambiguity code `39999`;
- genuine EOF diagnostics remaining visible;
- trailing backslash-comment behavior with and without a final newline.

## Review status

- Task 1 position fix: spec review passed; code-quality review approved with no Critical or Important issues.
- Task 2: final spec review passed before the last quality-review corrections.
- The quality review found three Important issues: genuine EOF results were filtered, a backslash-comment could swallow the suffix, and nested/inactive declarations could activate context.
- Commit `18c6cbc` fixes all three with failing tests first and the green counts above.
- A final spec re-review and final code-quality re-review of `18c6cbc` have not yet been performed.

## Remaining work before integration

1. Re-run Task 2 spec compliance review over `70f141b..18c6cbc`.
2. Re-run Task 2 code-quality review and address any Critical or Important findings.
3. Run integrated suites:
   - `npm test -w @shader-studio/slang-language-service`
   - `npm test -w @shader-studio/monaco`
   - `npm test -w @shader-studio/rendering`
   - `npm test -w extension`
4. Run builds and checks:
   - `npm run build -w @shader-studio/slang-language-service`
   - `npm run build:code -w extension`
   - `cd ui && npm run check && npm run build`
   - relevant ESLint commands and `git diff --check`
5. Manually verify the Extension Development Host against the foundation fixture:
   - hover `iResolution`, `float4`, and `cos`;
   - completion and signature help without `Missing field: "line"`;
   - no false entry-file `iResolution` diagnostic;
   - strict helper-module diagnostics remain;
   - actual render-compiler errors still appear independently.

## Architectural caution when removing or restoring it

The package named `@shader-studio/slang-language-service` is not purely editor tooling. Rendering currently imports shared compiler-critical utilities from it, including canonical path normalization, language-header handling, the virtual filesystem synchronizer, and WASM API helpers.

Therefore, removing the whole package from the active branch will break Slang rendering. To shelve editor language features while keeping rendering, remove or disable only:

- VS Code provider registration/client/worker and its packaged worker assets;
- Monaco `SlangMonacoAdapter` and browser language worker integration;
- language-service-specific tests and settings.

Keep the shared compiler utilities, or move them into a neutral shared package before deleting the language-service package.

## Immediate workaround

On a build that still contains the editor service, it can be disabled without affecting rendering:

```json
"shader-studio.slangLanguageFeatures": false
```

Shader Studio compiler diagnostics continue to work when this setting is disabled.
