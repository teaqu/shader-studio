# Slang → WebGPU pipeline — implementation plan (Option B)

A separate Slang/WebGPU rendering path living **beside** the existing
GLSL/WebGL path, selected per shader by file type. No debugging/inspector for
Slang in v1 (those stay GLSL-only).

## What the spike already proved

All Day-1 unknowns are resolved (`spike/slang-webgpu/`):

- ✅ **WebGPU is available in the VS Code (Electron) webview** — `navigator.gpu`
  returns an adapter + device (nvidia confirmed). This was the gating risk.
- ✅ **slang-wasm loads in the webview** — needs CSP `'unsafe-eval'`
  (already allowed in the real panel) + `'wasm-unsafe-eval'`.
- ✅ **`.slang` → WGSL compiles** (`getTargetCode`), bindings land where the
  WGSL pipeline expects (`@group(0) @binding(0)`).
- ✅ **WGSL renders** through a WebGPU fullscreen-quad pipeline.
- ⚠️ **Lesson:** the webview resource server returns an empty body for `.slang`.
  Source must be read in the **extension host** and passed over the existing
  message transport — never `fetch`ed in the webview. (This matches how GLSL
  already flows.)

## Architecture: parallel engine behind the existing interface

The UI depends on the `RenderingEngine` **interface**
([rendering/src/types/RenderingEngine.ts]), not the concrete WebGL class. That
is the entire seam.

```
                         ┌─ RenderingEngine (interface) ─┐
   ui/* (unchanged) ─────┤                               │
                         ├─ RenderingEngine  (WebGL/GLSL) │  ← exists today
                         └─ WebGPURenderingEngine (Slang) │  ← new
```

`WebGPURenderingEngine` implements the same interface, so `ShaderPipeline`,
`ShaderViewer`, `RecordingManager`, `PixelInspectorManager`, etc. keep working
against it. Methods that are GLSL/debug-specific (`createVariableCapturer`,
`getVariableCaptureCompileContext`) throw a clear "not supported for Slang"
error in v1.

### Why a second engine, not a backend abstraction inside the current one

WebGL2 and WebGPU need **different canvas contexts** (`getContext('webgl2')` vs
`getContext('webgpu')`) — they can't share a canvas. Switching language already
means tearing down and recreating the engine + canvas, so a clean second
implementation is simpler and lower-risk than threading a backend switch
through every method of the existing engine.

## The selection seam

1. **Detect language from the shader path** (extension side). Add `.slang` to a
   new `isSlangDocument()` alongside [isGlslDocument]; thread a
   `language: 'glsl' | 'slang'` field onto `ShaderSourceMessage`
   ([types/src]). Default `'glsl'` so nothing else changes.
2. **Select the engine** at [ShaderViewer.svelte:882]. When the active shader's
   language flips, dispose the current engine and construct the other. Both
   implement `RenderingEngine`, so the rest of the component is untouched.
3. **Source stays message-driven** — `ShaderProvider` already reads files and
   posts `ShaderSourceMessage`; we only add the `language` tag and (later) make
   the file scanners/creators `.slang`-aware.

## Milestones

Each milestone is independently runnable and demoable.

### M0 — Spike (done)
`.slang` → WGSL → WebGPU quad in the real webview. ✅

### M1 — Single-pass Slang image shader (the first real integration)
Goal: open a `.slang` file, see it render in the actual Shader Studio panel
(no config, no buffers, no textures).

- `rendering/src/webgpu/WebGPURenderingEngine.ts` — implements
  `RenderingEngine`; owns the WebGPU device, context, one render pipeline.
- `rendering/src/webgpu/SlangCompiler.ts` — wraps slang-wasm: source → WGSL +
  reflection. Lazy-loads the wasm once, caches the global session.
- `rendering/src/webgpu/SlangModuleLoader.ts` — loads `slang-wasm.js`/`.wasm`.
  Ship the wasm as a UI asset; the loader resolves it via a webview URI passed
  in (no `fetch` of unknown extensions).
- A **Slang prelude convention**: define the ShaderToy-equivalent entry point
  (`mainImage`) and uniforms (`iResolution`, `iTime`, …) as a Slang module the
  user code imports, so existing mental model carries over.
- Uniforms: one uniform buffer (`iResolution`, `iTime`, `iTimeDelta`,
  `iFrame`, `iMouse`) written each frame. Reuse `TimeManager`/`MouseManager`
  (they're backend-agnostic).
- Wire language detection (extension + message field) and engine selection.

Exit: an animated `.slang` shader using `iTime`/`iResolution`/`iMouse` renders
in-panel, hot-reloads on save, and shows compile errors in the existing error UI.

### M2 — Error mapping + custom uniforms
- Map Slang diagnostics (line/column) back to the user's source for the
  existing error overlay (mirror [ShaderErrorFormatter]).
- Custom uniforms (the `iChannel`-style sliders) → reflection-driven uniform
  buffer members.

### M3 — Multipass / buffers
- Port the ping-pong buffer model ([BufferManager]) to WebGPU textures
  (`RENDER_ATTACHMENT | TEXTURE_BINDING`). The pass orchestration in
  [ShaderPipeline] is largely backend-agnostic and can be mirrored.
- `iChannelN` sampling → bind-group entries (texture + sampler) driven by
  reflection.

### M4 — Resources (textures / video / audio)
- Image textures: `copyExternalImageToTexture`.
- Video: `importExternalTexture` (or per-frame copy).
- Audio FFT texture: per-frame `writeTexture`.
- Reuse the existing `ResourceManager` loaders for decode/IO; only the GPU
  upload differs.

### M5 — Capture / recording / readPixel parity
- WebGPU readback is **async** (`buffer.mapAsync`), unlike `gl.readPixels`.
  Pixel inspector + recording + thumbnails need an async read path on the
  Slang engine. (Variable-capture debugging stays GLSL-only.)

## Explicitly out of scope for v1

- Slang **debugging / variable inspector / inline preview** — these are a GLSL
  source-text parser ([debug/]). Slang shaders launch with debug disabled.
- Slang for the standalone web/electron targets is free (same code), but the
  primary target is the VS Code webview.

## Key risks / open decisions

- **Uniform layout drift.** Slang's WGSL std140 padding must match the JS
  buffer writes. Mitigation: drive offsets from **reflection**, never hardcode.
- **slang-wasm size (~21MB wasm).** Lazy-load only when a `.slang` shader is
  opened; don't bloat the GLSL path. Decide: bundle vs. download-on-first-use.
- **Async readback** reshapes the capture/recording contracts (M5).
- **Engine swap cost** on language flip (canvas recreation) — acceptable; it's
  the same teardown a path change already does.

## First PR (M1) — file-level change list

New (all additive, GLSL path untouched):
- `rendering/src/webgpu/WebGPURenderingEngine.ts`
- `rendering/src/webgpu/SlangCompiler.ts`
- `rendering/src/webgpu/SlangModuleLoader.ts`
- `rendering/src/webgpu/uniforms.ts` (uniform buffer pack/layout)
- `ui` asset: `slang-wasm.js` + `.wasm` (copied like other UI assets)

Touched (small, backward-compatible):
- `types/src` — add `language?: 'glsl' | 'slang'` to `ShaderSourceMessage`.
- `extension/src/app/GlslFileTracker.ts` (or new `ShaderLanguage.ts`) —
  `isSlangDocument()`; tag the message language.
- `extension/src/app/ShaderProvider.ts` — accept `.slang` files.
- `ui/src/lib/components/ShaderViewer.svelte` — select engine by language.
- `rendering/src/index.ts` — export `WebGPURenderingEngine`.

Tests (per AGENTS.md, every change covered):
- `SlangCompiler` compile + reflection (headless, Node — proven feasible).
- Engine-selection logic by language.
- `WebGPURenderingEngine` against the `RenderingEngine` interface contract
  (mock device where possible; e2e behind the existing WebGL e2e harness).
