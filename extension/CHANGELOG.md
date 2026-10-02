# Change Log

### Unreleased

- Breaking: `mainVertex` now receives the vertex index as its first parameter in every language. Add it to existing vertex shaders:
  - GLSL: `void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv)`
  - Slang: `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)`
  - WGSL: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)`
- Breaking: fullscreen passes now draw one three-vertex triangle in GLSL, matching Slang and WGSL. A GLSL fullscreen vertex shader runs three times instead of six, `gl_VertexID` is 0–2 instead of 0–5, and `position` and `uv` start at the corners of a triangle covering the screen, `(-1, -1)`, `(3, -1)` and `(-1, 3)`, instead of the four corners of a quad. Shaders that moved individual quad corners need rewriting; fragment-only shaders and plane, cube, sphere, and model geometry are unaffected.
- The fullscreen `normal` passed to a GLSL vertex shader is now `(0, 0, 1)`, matching Slang and WGSL.
- Fullscreen vertex shaders can place their own triangle from `vertexIndex`; pixels it leaves uncovered are black in every language.
- Plane, cube, sphere, and model vertex shaders receive the mesh vertex index.
- New Vertices geometry: draw any number of vertices as triangles, lines, or points, placed by the vertex shader from `vertexIndex`. Set `{ "type": "vertices", "vertexCount": 6, "topology": "triangle-strip", "space": "clip" }` in `.sha.json`, or pick Vertices in the Geometry dropdown and use the new Vertices, Topology and Space controls. `topology` is `triangle-list` (default), `triangle-strip`, `line-list`, `line-strip`, or `point-list`; lines and points are 1px wide. `space` is `world` (default), where the orbit camera views your shape in 3D with depth, or `clip`, where positions are screen coordinates from `(-1, -1)` to `(1, 1)` and `mainImage` gets the real pixel coordinate. Fullscreen passes still draw one three-vertex triangle; `vertexCount`, `topology` and `space` on any other geometry are config errors.
- New built-in uniform `iVertexCount` (GLSL `int`, Slang `uint`, WGSL `u32`): the vertices geometry's `vertexCount`, 3 for fullscreen, or the mesh vertex count for plane, cube, sphere, and model geometry.
- New fragment built-in `iVertexUv` (GLSL `vec2`, Slang `float2`, WGSL `vec2f`): the perspective-correct interpolated `uv` written by `mainVertex`, available for fullscreen, vertices, and mesh geometry without changing the `mainImage` signature.
- New per-pass `blend` setting for Image and buffer passes: `none` (default), `alpha`, `premultiplied`, or `additive`, in `.sha.json` or the config panel's new Rendering section. It works with every geometry. A blended buffer pass falls back from 32-bit to 16-bit float storage, with a warning, on GPUs that cannot blend 32-bit floats.
- New per-pass `depth` setting for vertices, plane, cube, sphere, and model geometry: `{ "test": true, "write": true, "compare": "less" }`, with Depth test, Depth write and Compare controls in the config panel. Turn `write` off for additive or transparent particles. Clip-space vertices default to `test: false`, so shapes draw in the order you emit them. `compare: "greater"` and `"greater-equal"` start from a cleared depth of 0 so they can pass.
- WebGL meshes now depth-test with `less` instead of `less-equal`, matching WebGPU. Set `"depth": { "compare": "less-equal" }` to keep the old behaviour.
- New per-pass `cull` setting for vertices, plane, cube, sphere, and model geometry: `none` (default), `back`, or `front`. Counter-clockwise triangles face the camera, as on the built-in meshes and glTF models, in both WebGL and WebGPU.
- Fixed Slang shaders failing to compile with "unreachable" after the preview had been recreated about a dozen times in one session.
- Fixed new standalone Slang vertex files declaring `uv` as `vec2` instead of `float2`.

### 1.2.0

- Added WGSL support: write `.wgsl` shaders with completion, hover documentation, snippets, and error checking. Use image, vertex, and compute passes, storage buffers, script uniforms, and visual debugging.
- Breaking: Slang channels are now accessed directly. Replace `inputs.albedo.Sample(uv)` with `albedo.Sample(uv)` and `inputs.albedo.size` with `albedo.size`. The `.sha.json` `inputs` field is unchanged.
- Breaking: remove `import shader_studio;` from Slang shaders. Built-in uniforms are available without an import.
- Improved WGSL hover documentation for variables, functions, built-in uniforms, and attributes such as `@compute` and `@workgroup_size`.
- `iMouse` now matches Shadertoy: `xy` follows the pointer only while a mouse button is held, `z` is positive while held, and `w` is positive only on the frame of the click.
- Vector completion now lists components, contiguous runs such as `xy`, `yz`, and `zw`, and reversals such as `yx`, `zyx`, and `bgra` in GLSL, Slang, and WGSL. Any other valid selection, such as `xyx` or `xxxx`, is offered as soon as you type it.
- WGSL hover, completion, and variable inspection now infer more valid expressions, including `bitcast`, integer bit operations, matrix transpose and scaling, and vector comparisons.
- Fixed false warnings for valid WGSL storage types, including half-precision values, vectors, matrices, and integer atomics. Storage structs containing integer atomic fields now infer and bind their stride correctly.
- Fixed WGSL variable inspection hiding values from channel samples, loop counters, and values at a block's closing brace. Values above a syntax error can now still be inspected.
- The WGSL Variable Inspector now shows function parameters and local variables. View built-in uniforms in the debug panel and script values in the config panel's Script tab.
- Fixed variable inspection sometimes failing when opening a shader that uses script uniforms.
- Fixed WGSL shaders failing to compile when using Common helpers.
- GLSL buffer passes now honour the Output format setting; previously WebGL always stored 32-bit buffers and ignored `rgba16float`.
- Fixed a config edit restarting running GLSL simulations: WebGL reallocated every buffer, while WebGPU kept the passes the edit did not change. Buffers now survive unless their own size, depth, or output format changed.
- Fixed WGSL channel load helpers offered by completion failing to compile.
- Fixed the cursor jumping and typed text appearing in the wrong place when editing the same shader in multiple editors.
- Fixed switching files losing edits, applying edits to the wrong file, or showing completions and Common helpers from another shader.
- Fixed signature help disappearing while editing, including inside nested WGSL calls.
- Fixed errors when switching files with symbol highlighting active.
- Standalone ships a WGSL compute example, Particle Swarm, driving 16384 particles through compute passes and storage buffers.
- Standalone saves stay responsive as your workspace grows.
- Fixed standalone edits, shader selection, and Hide Buffers preferences being lost after an immediate reload, including when the system clock changes.

### 1.1.1

- Fixed scripts not loading, missing uniform values, and scripts running while paused.
- Fixed variable inspector clicks and hover previews sometimes not working.
- Fixed the GLSL language server not recognising Common-file `#define` macros.
- Fixed false syntax errors in empty or comment-only GLSL Common files.
- Fixed helper files replacing the shader preview and GLSL-to-JavaScript conversion failing.

### 1.1.0
- Write shaders in Slang as well as GLSL, with the same preview, config panel, inputs, and debugging.
- Run compute passes over storage buffers and read the results from your image pass.
- Render onto 3D geometry: load a GLB model, orbit the camera around it, and light it with the surface position and normal. Each pass chooses 2D or 3D.
- Move vertices before they are shaded with a vertex shader, in either language.
- GLSL and Slang language servers: completions, hover documentation, errors as you type, go to definition, find references, rename, symbol highlighting, colour swatches, and greyed-out unused variables — across your Common file and imports.
- Debug Slang shaders: inspect values line by line, follow them into imported files, and see which lines never ran.
- Browse your shaders from the sidebar, with previews, renaming, and deletion.
- Watch GPU time per frame in the performance panel to see whether the GPU or the frame loop is the bottleneck.
- Name buffer passes anything you like, and rename them from the config tabs.
- Use a video file as an audio input, and mute channels individually — muting is saved with the shader.
- Open a shader in the browser with the same docked layout as the panel.
- Toggle the shader lock with `Ctrl+L` / `Cmd+L`.
- Spell checking knows shader vocabulary, and the Shader Validator extension no longer conflicts.
- Fixes: a broken config reports the error instead of showing a black frame, error markers no longer linger after the code is fixed, the mouse position holds still while paused and follows hover, and cubemaps work in the variable inspector.

### 1.0.2
- Added a toggleable marker for the locked pixel inspector position. Your choice is remembered between sessions.

### 1.0.1
- Fixed the extension failing to start after installation.

### 1.0.0
- First stable release of Shader Studio.
- Live Shadertoy-style GLSL previews in VS Code panels, external windows, and browsers.
- Visual configuration editor for multi-pass shaders with textures, video, audio, cubemaps, buffers, keyboard input, and common/script passes.
- Visual debugging tools including pixel inspection, inline rendering, variable capture, normalization, loop controls, and parameter controls.
- Monaco editor overlay with compile modes, shader locking, panel layout persistence, and profile management.
- Shader Explorer, snippet library, time controls, recording, resolution controls, camera uniforms, and performance tooling.
- Improved documentation and installation from VS Code Marketplace, Open VSX, and GitHub Releases.

### 0.2
- Pixel Inspector

### 0.1
- More transpile fixes

### 0.0.11
- Transpile package fix

### 0.0.10
- Transpile shader to javascript for debugging
- Common buffer bug fix

### 0.0.9
- Added video inputs
- Added common buffer
- Better error handling
- Bug fixes

### 0.0.8
- Shader Explorer
- Added performance monitoring
- bug fixes

### 0.0.7
- Electron install fix all platforms

### 0.0.6
- Electron install fix on macos
- Fixed shader detection for supported file extensions
- Recommended a shader syntax highlighter

### 0.0.5
- Create default shader from menu

### 0.0.4
- Electron fix

### 0.0.3
- Fixed custom websocket port
- Fixed render loop breaking on error

### 0.0.2
- Changed config UI to act like a markdown preview.
- Expanded the extension guide.
- Fixed locked shader not refreshing to new file on unlock.
- Fixed JSON not updating when changing texture config on the UI.
- Fixed shader breaking on invalid config.
- Fixed electron icon and title bar on macOS.

### 0.0.1
- Initial release
