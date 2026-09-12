# Slang Support

Slang shaders (`.slang`) run on the WebGPU pipeline with compute passes,
storage buffers and a module system. Fragment shaders define `mainImage`,
vertex shaders define the vertex hook, and compute passes declare `[shader("compute")]`
entry points (see [Compute Passes](compute.md)).

Named channel metadata and sampling examples are in [Channels](channels.md).

## What works

- **Editing:** completion, hover, go to definition, references, highlights and
  rename are covered by named tests (`SlangLanguageService.test.ts`,
  `rename.test.ts`, `SlangRename.integration.test.ts`), including overload-aware
  rename and generic helper binding (`__generic` spelling included).
  Diagnostics report unused locals/parameters and flow through the official
  browser language server.
- **Imports:** corpus imports resolve without host errors. Symbols reached
  through `__include` (generated prelude built-ins, not authored code) are
  deliberately refused by hover and rename.
- **Rendering:** everything GLSL renders, plus compute passes
  (`SlangComputePipeline.test.ts`, corpus `compute-lab`/`particles`) and
  storage buffers (`SlangPrelude.storage.test.ts`,
  `WebGPURenderingEngine.storage.test.ts`).
- **Debugging:** inline preview plans, fragment and compute-stage native
  capture plans (`SlangNativeDebug.acceptance.test.ts`,
  `SlangVariableCapture.capability.test.ts`).
- **Hosts:** VS Code extension and standalone browser.

## Limitations

- No workspace symbol search (all languages).
- No vertex-stage debugging (all languages).
- Storage values read back at the engine level, but surfacing through the
  debug panel is unasserted.

Back to the full matrix: [Language Support](language-support.md).
