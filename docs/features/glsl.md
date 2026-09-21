# GLSL Support

GLSL shaders (`.glsl`) use WebGL2. GLSL is the original
Shader Studio language: fragment shaders use `mainImage`,
optional vertex shaders use the vertex hook (see [Vertex
Shaders](vertex-shaders.md)), and buffer passes compose multipass projects
(see [Configure Buffers And Inputs](config-buffers.md)).

Named channel metadata and sampling examples are in [Channels](channels.md).

## What works

- **Editing:** completion, hover, go to definition, references, highlights, and
  rename. Diagnostics report unresolved symbols and unused locals. See
  [Language Servers](language-servers.md) for editor instructions and rename scope.
- **Rendering:** single pass, multipass buffers, Common, vertex shaders,
  textures, cubemaps, audio/video inputs, keyboard input, model geometry and
  script custom uniforms. Compute passes and storage buffers are not available for GLSL.
- **Debugging:** inline rendering and fragment-stage variable capture work,
  including inside Common helpers.
- **Hosts:** VS Code extension and standalone browser.

## Limitations

- No workspace symbol search (all languages).
- No vertex-stage debugging (all languages).

Back to the full matrix: [Language Support](language-support.md).
