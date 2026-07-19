# Slang Shader Explorer Support Design

## Goal

Make Shader Explorer discover, thumbnail, and hover-preview existing Slang shaders using the repository's current Slang/WebGPU renderer. Do not add rendering features or expand the Slang authoring format.

## Root Cause

The production Shader Explorer bundle imports `@shader-studio/rendering` through its public index. That index re-exports `WebGPURenderingEngine`, which pulls `SlangModuleLoader` into the startup bundle. `SlangModuleLoader` and the generated Slang WASM JavaScript use `new Function(...)`. Shader Explorer's VS Code webview CSP omits `unsafe-eval`, so the bundle fails immediately with an `EvalError`.

The CSP exception is only the first failure. Shader Explorer currently:

- searches for `.glsl`, `.frag`, and `.vert` files, but not `.slang`;
- returns shader source without an explicit language;
- always constructs the WebGL `RenderingEngine` for thumbnails and hover previews; and
- does not receive URLs for the extension's existing Slang JavaScript, WASM,
  and worker assets.

Relaxing the CSP alone would stop the startup exception but would not render Slang shaders.

## Scope

This change will:

- include `.slang` in Shader Explorer discovery and search;
- identify requested shader source as `glsl` or `slang`;
- use the existing WebGL engine for GLSL and the existing WebGPU engine for Slang;
- reuse the Slang JavaScript, WASM, and compile-worker assets already packaged
  for the main UI, without emitting a second WASM copy;
- update Shader Explorer's webview CSP with the directives already required by the main shader viewer; and
- preserve thumbnail capture, thumbnail caching, resizing, hover rendering, config loading, and buffer loading for both languages.

This change will not:

- add Slang renderer features;
- change the Slang source convention or config format;
- change the main Shader Studio viewer;
- refactor the rendering package's CommonJS module strategy; or
- redesign Shader Explorer UI.

## Architecture

### Extension-side discovery and messages

`ShaderExplorerProvider` will extend its workspace glob to include `.slang`. The existing config-path logic already maps `.slang` to `.sha.json`, so discovered Slang files keep the same config behavior as GLSL files.

The `shaderCode` response will include a `language` field derived from the requested path using the existing shader-language helper. The webview will consume this field instead of duplicating extension parsing rules.

### Explorer-side engine selection

Shader Explorer will add a small local engine factory following the established main-UI pattern:

- `glsl` or missing language creates the existing WebGL engine;
- `slang` creates `WebGPURenderingEngine` with the existing Slang asset URLs.

Shader preview code will depend on the shared `RenderingEngine` interface rather than the WebGL concrete class. The same factory will be used for one-frame thumbnails and animated hover previews. Cleanup will remain backend-agnostic: stop and dispose the selected engine, while WebGL context loss remains a best-effort WebGL-only cleanup.

### Shared Slang assets

The main UI's build remains the canonical producer of:

- `slang-wasm.js`;
- `slang-wasm.wasm`; and
- the compiled `slangCompileWorker` chunk.

After the main UI build, a small build step will validate that exactly one of
each required artifact exists and write their relative filenames to a Slang
asset manifest in `ui-dist`. The manifest prevents runtime code from depending
on Vite's content hashes.

`ShaderExplorerProvider` will read that manifest, map each canonical asset
through `webview.asWebviewUri()`, and inject the three URLs into the Explorer
HTML as metadata. Its webview resource roots will include `ui-dist` in addition
to `shader-explorer-dist` and the workspace.

Shader Explorer's local asset resolver will read the injected URLs and pass
them to `WebGPURenderingEngine`. It will not import the raw Slang assets, so its
Vite build will not emit another JavaScript runtime, worker, or 21 MB WASM
binary.

VS Code webviews are isolated JavaScript realms, so the main viewer and Shader
Explorer will still initialize separate Slang runtime instances. They will,
however, load the same packaged files rather than storing duplicate bytes in
the extension.

### Content Security Policy

`ShaderExplorerProvider.getHtmlForWebview()` will align the relevant directives with `PanelManager`, the working main-viewer implementation:

- `script-src`: webview source, `blob:`, `wasm-unsafe-eval`, and `unsafe-eval`;
- `worker-src`: webview source and `blob:`;
- `connect-src`: webview source and `blob:`; and
- existing image, media, style, and font allowances remain intact.

Both the existing-CSP and no-CSP branches must produce these directives. `unsafe-eval` is required by the current generated Slang runtime, so removing it would require replacing the upstream runtime rather than a Shader Explorer fix.

## Data Flow

1. The extension discovers a `.slang` file and sends it in `shadersUpdate`.
2. A visible card requests its shader source.
3. The extension loads the existing source, config, and buffer files, converts resource paths, and returns `language: "slang"`.
4. Shader Preview asks its engine factory for the language-specific engine.
5. The factory creates `WebGPURenderingEngine` with the canonical asset URLs
   injected by the extension host.
6. The existing Slang renderer compiles and renders the thumbnail or hover animation.
7. Thumbnail capture and caching continue through the existing message path.

GLSL follows the same flow but continues to use the WebGL engine.

## Error Handling

Existing compilation-failure behavior remains authoritative: a failed Slang compile marks the card failed, invokes the existing callback, and cleans up the engine. Missing WebGPU support is surfaced through the existing WebGPU initialization error and follows the same card failure path.

Asset or worker initialization errors use the renderer's existing fallback/error behavior. No silent fallback from Slang to GLSL will be added because compiling Slang as GLSL obscures the real failure.

If the canonical asset manifest or a required artifact is missing, the host
will log the packaging error and the Slang preview will follow the existing
compilation-failure card path. GLSL previews must remain usable.

## Testing

Extension tests will cover:

- the discovery glob includes `.slang`;
- a discovered `.slang` file is returned with config metadata;
- a Slang `shaderCode` response includes `language: "slang"`;
- GLSL responses remain `language: "glsl"`;
- existing CSP markup gains all Slang runtime tokens; and
- generated CSP markup contains the same tokens when the built HTML has no CSP.

Shader Explorer tests will cover:

- the factory selects WebGL for GLSL and WebGPU for Slang;
- the canonical main-UI build produces a complete Slang asset manifest;
- Shader Explorer receives the manifest's webview-mapped asset URLs;
- the WebGPU engine receives those injected Slang asset URLs;
- Shader Preview routes the response language through the factory for thumbnail rendering;
- hover rendering uses the same selected engine; and
- GLSL behavior remains unchanged.

Verification will include Shader Explorer unit tests and type checks, extension
tests, ESLint, the full UI type check required by `AGENTS.md`, and production
builds confirming that the extension contains one Slang WASM binary and that
Shader Explorer emits no duplicate Slang runtime assets.
