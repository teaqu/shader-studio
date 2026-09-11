# WGSL Support

WGSL shaders (`.wgsl`) run on the WebGPU pipeline with no Slang toolchain
involved. Authoring syntax — `mainImage`, channel free functions, the pointer
based `mainVertex` hook — is documented in [WGSL Shaders](wgsl-authoring.md).
This page records what is proven to work and where WGSL deliberately differs.

## What works

- **Editing:** completion (user symbols, intrinsics, built-ins, uniforms,
  channel resources), hover, cross-Common definition resolution, references,
  highlights and rename including Common-wide rename with collision declines
  (`WgslLanguageService.test.ts`). WGSL has no generics and no
  import/include mechanism.
- **Rendering:** the full WebGPU feature set — single pass, multipass,
  Common, vertex (`mainVertex` contract), compute
  (`WebGPURenderingEngine.compute.test.ts`, corpus `compute-lab`) and storage
  buffers — plus textures, cubemaps, audio/video, keyboard, models and custom
  uniforms. The fixture corpus holds some three dozen WGSL fixtures, not two.
- **Debugging:** in-place preview plans and native capture plans with user
  slots after the hidden marker.
- **Hosts:** VS Code extension and standalone browser. WGSL needs a
  WebGPU-capable host; without one it fails with an error naming the missing
  feature.

## Limitations

- **Diagnostics are hints only.** WGSL compiles in the renderer
  (WebGPU/Dawn) and the renderer compiler always wins; the language service
  does not duplicate its diagnostics.
- **Shadowing** has no dedicated test, and neither does **stale-request
  handling** — both are cheap to add and not yet written.
- **Compute-stage debug capture** is implemented but untested (Slang has the
  equivalent test).
- No workspace symbol search, no vertex-stage debugging (all languages).

Back to the full matrix: [Language Support](language-support.md).
