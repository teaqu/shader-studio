# GLSL Support

GLSL shaders (`.glsl`) run on the WebGL2 pipeline. GLSL is the original
Shader Studio language: fragment shaders use the `mainImage` contract,
optional vertex shaders use the vertex hook (see [Vertex
Shaders](vertex-shaders.md)), and buffer passes compose multipass projects
(see [Configure Buffers And Inputs](config-buffers.md)).

Named channel metadata and sampling examples are in [Channels](channels.md).

## What works

- **Editing:** completion, hover, go to definition, references, highlights, and
  rename. Diagnostics report unresolved symbols and unused locals. See
  [Language Servers](language-servers.md) for editor instructions and rename scope.
- **Includes:** environment-provided `#include`s complete and navigate. GLSL
  has no module imports and no generics.
- **Rendering:** single pass, multipass buffers, Common, vertex shaders,
  textures, cubemaps, audio/video inputs, keyboard input, model geometry and
  script custom uniforms. There is no compute and no storage-buffer support — WebGL2 has
  neither.
- **Debugging:** inline rendering and fragment-stage variable capture work,
  including inside Common helpers.
- **Hosts:** VS Code extension and standalone browser.

## Limitations

- No workspace symbol search (all languages).
- No vertex-stage debugging (all languages).

Back to the full matrix: [Language Support](language-support.md).
