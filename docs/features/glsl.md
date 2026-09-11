# GLSL Support

GLSL shaders (`.glsl`) run on the WebGL2 pipeline. GLSL is the original
Shader Studio language: fragment shaders use the `mainImage` contract,
optional vertex shaders use the vertex hook (see [Vertex
Shaders](vertex-shaders.md)), and buffer passes compose multipass projects
(see [Configure Buffers And Inputs](config-buffers.md)).

## What works

- **Editing:** completion, hover, go to definition, references, highlights and
  rename (same-file, cross-file and Common) are all covered by named tests in
  `language-servers/glsl/src/test/GlslLanguageService.test.ts`. Diagnostics
  report unresolved symbols and unused locals, with a non-vacuous guard in
  `corpusMirrors.test.ts`.
- **Includes:** environment-provided `#include`s complete and navigate. GLSL
  has no module imports and no generics.
- **Rendering:** single pass, multipass buffers, Common, vertex shaders,
  textures, cubemaps, audio/video inputs, keyboard input, model geometry and
  script custom uniforms all render in the fixture corpus with lit-pixel
  assertions. There is no compute and no storage-buffer support — WebGL2 has
  neither.
- **Debugging:** inline rendering and fragment-stage variable capture work.
- **Hosts:** VS Code extension and standalone browser.

## Limitations

- No workspace symbol search (all languages).
- No vertex-stage debugging (all languages).
- Common capture mapping in the debugger is unproven (all languages).

Back to the full matrix: [Language Support](language-support.md).
