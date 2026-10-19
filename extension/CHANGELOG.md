# Change Log

### 1.3.0

#### Breaking

- `mainVertex` now takes the vertex index first:
  - GLSL: `void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv)`
  - Slang: `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)`
  - WGSL: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)`
- GLSL fullscreen passes draw one triangle (3 vertices) instead of a quad (6), matching Slang and WGSL. Vertex shaders that moved quad corners need rewriting.
- WebGL meshes depth-test with `less` instead of `less-equal`. Set `"depth": { "compare": "less-equal" }` to keep the old behaviour.

#### Geometry and rendering

- Vertices geometry: draw any number of vertices as triangles, lines or points, placed by the vertex shader.
- Instancing with `instanceCount`, plus `iInstanceIndex` and `iInstanceCount`.
- Per-pass blending, clear colour, depth testing, face culling and 4× antialiasing.
- Wireframe and point topologies for meshes.
- New built-ins: `iVertexCount`, `iVertexUv`, `iFrontFacing`, `iViewMatrix`, `iProjectionMatrix` and `iViewProjection`.
- WGSL and Slang can share native vertex, fragment and compute entry points in one file, with multiple render targets.
- Cubemap buffers for GLSL and Slang.

#### Inputs

- VR preview with `mainVR`, on desktop or in a WebXR headset, with optional controller inputs.
- `iPointer` mouse input with hover, all buttons and the scroll wheel. Right-click and scrolling no longer trigger browser actions over the canvas.
- Volume (KTX2) inputs with a 3D preview, plus built-in random volumes.
- Webcam, screen, microphone and shared-audio inputs (in the browser).
- Audio channels use Shadertoy's analyser settings, so audio-reactive shaders may respond differently.
- The built-in Nebula texture and Desert cubemap are available in VS Code too.

#### Capture and debugging

- **Live** and **Render** capture modes for screenshots and recordings.
- Redesigned storage buffers, with their own settings and a live value inspector.
- Config passes are cards: preview any single pass with its eye button.
- Buffer and compute passes get a **Shader file** picker and **Open editor**.

#### Explorer and editor

- Shader Explorer refreshes when files change, and its options moved to an **Explorer settings** panel.
- Optional **Only keep active shader files open** setting.
- Opening a linked buffer, Common or vertex file keeps the current preview without locking it.
- New shaders open at 16:9; the **Auto** aspect ratio is now called **Screen**.

#### AI assistant (VS Code)

- **Shader Studio: Connect AI Assistant** lets a local MCP assistant read and edit shaders, check errors, capture images and control the preview. Off by default.

#### Standalone

- Works on phones and tablets, and installs as an offline app.
- Saves automatically, shows the save status, and can export and import workspace backups.
- Updates itself when a new version is out.
- New **Files** pane, file uploads and drag and drop.
- Global settings and a new **Pixel** theme.

#### Fixes

- Video inputs no longer keep the GPU busy while the preview is paused or hidden.
- Fixed "Compile timed out" for background GLSL previews.
- Fixed config edits sometimes being undone.
- Fixed Slang failing with "unreachable" after many preview reloads.
- Fixed a spurious config error for untitled shaders.
- Fixed see-through standalone tab menus.

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
