# Change Log

### 1.3.0

- Breaking: `mainVertex` now receives the vertex index as its first parameter in every language. Add it to existing vertex shaders:
  - GLSL: `void mainVertex(int vertexIndex, inout vec3 position, inout vec3 normal, inout vec2 uv)`
  - Slang: `void mainVertex(uint vertexIndex, inout float3 position, inout float3 normal, inout float2 uv)`
  - WGSL: `fn mainVertex(vertexIndex: u32, position: ptr<function, vec3f>, normal: ptr<function, vec3f>, uv: ptr<function, vec2f>)`
- Breaking: fullscreen passes now draw one three-vertex triangle in GLSL, matching Slang and WGSL. A GLSL fullscreen vertex shader runs three times instead of six, `gl_VertexID` is 0–2 instead of 0–5, and `position` and `uv` start at the corners of a triangle covering the screen, `(-1, -1)`, `(3, -1)` and `(-1, 3)`, instead of the four corners of a quad. Shaders that moved individual quad corners need rewriting; fragment-only shaders and plane, cube, sphere, and model geometry are unaffected.
- The fullscreen `normal` passed to a GLSL vertex shader is now `(0, 0, 1)`, matching Slang and WGSL.
- Fullscreen vertex shaders can place their own triangle from `vertexIndex`; pixels it leaves uncovered are black in every language.
- Plane, cube, sphere, and model vertex shaders receive the mesh vertex index.
- New Vertices geometry: draw any number of vertices as triangles, lines, or points, placed by the vertex shader from `vertexIndex`. Set `{ "type": "vertices", "vertexCount": 6, "topology": "triangle-strip", "space": "clip" }` in `.sha.json`, or pick Vertices in the Geometry dropdown and use the new Vertices, Topology and Space controls. `topology` is `triangle-list` (default), `triangle-strip`, `line-list`, `line-strip`, or `point-list`; lines and points are 1px wide. `space` is `world` (default), where the orbit camera views your shape in 3D with depth, or `clip`, where positions are screen coordinates from `(-1, -1)` to `(1, 1)` and `mainImage` gets the real pixel coordinate. Fullscreen passes still draw one three-vertex triangle. `vertexCount` and `space` apply only to vertices geometry; meshes accept the topologies described below.
- New built-in uniform `iVertexCount` (GLSL `int`, Slang `uint`, WGSL `u32`): the vertices geometry's `vertexCount`, 3 for fullscreen, or the mesh vertex count for plane, cube, sphere, and model geometry.
- New fragment built-in `iVertexUv` (GLSL `vec2`, Slang `float2`, WGSL `vec2f`): the perspective-correct interpolated `uv` written by `mainVertex`, available for fullscreen, vertices, and mesh geometry without changing the `mainImage` signature.
- New fragment built-in `iFrontFacing` (`bool` in every language): reports whether vertices and mesh primitives are front-facing, and is always `true` for fullscreen passes.
- New instancing: add `"instanceCount": n` to vertices, plane, cube, sphere, or model geometry to draw it `n` times in one draw call, or use the new Instances control under Geometry. New built-ins `iInstanceIndex` (which copy is being drawn, in the vertex and fragment shader) and `iInstanceCount` are GLSL `int`, Slang `uint`, and WGSL `u32`. Fullscreen passes always draw one copy; `instanceCount` on fullscreen geometry is a config error.
- New per-pass `samples` setting for vertices, plane, cube, sphere, and model geometry: `4` turns on multisample antialiasing for triangle, line and point edges, `1` (default) leaves it off. Choose it with the Antialiasing control under Rendering. A multisampled buffer pass stores `rgba16float`, with a warning, because 32-bit float textures cannot be multisampled in WebGPU.
- Plane, cube, sphere, and model geometry accept a `topology`: `triangle-list` (default), `line-list` for a wireframe of each unique edge, or `point-list` for each unique vertex as a 1px point. Pick Triangles, Wireframe or Points with the Topology control in the config panel.
- New built-ins `iViewMatrix`, `iProjectionMatrix` and `iViewProjection` (GLSL `mat4`, Slang `float4x4`, WGSL `mat4x4f`): the orbit camera that meshes and world-space vertices are drawn with, available in vertex and fragment shaders. Project world points yourself in clip space with `iViewProjection` and a divide by `w`.
- New per-pass `blend` setting for Image and buffer passes: `none` (default), `alpha`, `premultiplied`, or `additive`, in `.sha.json` or the config panel's new Rendering section. It works with every geometry. A blended buffer pass falls back from 32-bit to 16-bit float storage, with a warning, on GPUs that cannot blend 32-bit floats.
- New per-pass `clear` colour for Image and buffer passes: an `[r, g, b, a]` array with components from 0 to 1, configurable under Rendering. It defaults to opaque black; use `[0, 0, 0, 0]` for transparent buffer layers.
- New per-pass `depth` setting for vertices, plane, cube, sphere, and model geometry: `{ "test": true, "write": true, "compare": "less" }`, with Depth test, Depth write and Compare controls in the config panel's Depth testing section. Turn `write` off for additive or transparent particles. Clip-space vertices default to `test: false`, so shapes draw in the order you emit them. `compare: "greater"` and `"greater-equal"` start from a cleared depth of 0 so they can pass.
- WebGL meshes now depth-test with `less` instead of `less-equal`, matching WebGPU. Set `"depth": { "compare": "less-equal" }` to keep the old behaviour.
- New per-pass `cull` setting for vertices, plane, cube, sphere, and model geometry: `none` (default), `back`, or `front`. Counter-clockwise triangles face the camera, as on the built-in meshes and glTF models, in both WebGL and WebGPU.
- Fixed Slang shaders failing to compile with "unreachable" after the preview had been recreated about a dozen times in one session.
- Clear colour, Clear alpha and Instances controls now follow the VS Code or standalone theme.
- Fixed new standalone Slang vertex files declaring `uv` as `vec2` instead of `float2`.
- Added standalone global settings for camera defaults, language services, color swatches, buffer navigation, and live editor preferences. Preferences persist independently of shader files and workspace resets.

- Add a per-pass Use viewer camera checkbox for WebGPU mesh stages, including built-in and mainVertex hooks.

- WGSL and Slang can share native vertex, fragment, and compute entry points in one source file. Select stages per pass in the config panel, insert new stages into the current file, and choose native or ShaderToy templates for new render passes. Selections are saved under `entryPoints`; existing ShaderToy hooks and legacy compute settings still load.

- Native WGSL and Slang fragment previews and captures now preserve interpolated inputs, mesh geometry, and structured color/depth outputs. Native parameters show their GPU-provided status, and Buffer captures respect the pass resolution.

- Vertex and fragment functions can be mixed independently with ShaderToy hooks. Native mesh stages can use the viewer camera matrices.

- Native WGSL and Slang buffer passes support multiple render targets with named output selectors, Create/Insert templates, and per-output debugging. Capture snapshots feedback, camera and storage state without advancing live simulations. GLSL stays single-output.

- New VR preview for fullscreen GLSL Image shaders: add `void mainVR(out vec4 fragColor, in vec2 fragCoord, in vec3 rayOrigin, in vec3 rayDirection)` next to `mainImage`, then open **VR** from the preview toolbar or options menu. **Desktop preview** lets you look around without a headset: move with W/A/S/D and Q/E, and look by dragging or with the arrow keys. In a browser with WebXR and a connected headset, click **Enter VR** to render each eye. **Headset navigation** (off by default) adds thumbstick movement with **Snap** or **Smooth** turning, and **Movement speed** and **Turn speed** apply to both views. Slang, WGSL and mesh passes keep using `mainImage`.
- New VR controller inputs: add `#define SHADER_STUDIO_VR_INPUTS` to read `iVRActive`, `iVRControllerPosition`, `iVRControllerDirection`, `iVRControllerButtons`, `iVRControllerAxes`, `iVRControllerFaceButtons`, `iVRControllerTouches` and `iVRControllerFaceTouches` (slot 0 is the left hand, 1 the right). Shaders without the define keep their own identifiers and stay Shadertoy-compatible.
- New built-in uniform `iPointer` in GLSL, Slang and WGSL: pointer position including hover, `inside`, `held`/`pressed`/`released` button masks (left = 1, right = 2, middle = 4, back = 8, forward = 16), `modifiers`, and `wheel`/`wheelDelta` scrolling. `iMouse` keeps its Shadertoy behaviour.
- New **Prevent default mouse actions** setting (`shader-studio.preview.preventMouseDefaults` in VS Code, on by default) stops context menus, middle-click actions, back/forward navigation and page scrolling over the canvas, so shaders can use right-click and the scroll wheel.
- The standalone Particle Swarm example now pushes particles away on right-drag; left-drag still pulls them in. Existing browser workspaces keep their saved copy.
- New volume inputs: choose **Volumes** in a channel's settings to load an uncompressed R8 or RGBA8 3D KTX2 file and sample it with a three-component coordinate in GLSL, Slang or WGSL. Set **Linear** or **Nearest** filtering and **Wrap X / Y / Z**, and inspect the volume in a rotatable 3D preview or with **Slices**. In `.sha.json`, use `{ "type": "volume", "path": "./clouds.ktx2" }`; `.size` includes depth.
- **Random Greyscale.ktx2** and **Random RGBA.ktx2**, 32 × 32 × 32 random noise volumes, are built in and can be chosen under **Volumes** without downloading a file.
- The built-in **Nebula Texture** and **Desert Cubemap** that standalone offers are now in the VS Code asset picker too, so shaders that use them open in either.
- Refreshed the built-in Nebula texture.
- New cubemap buffers for GLSL and Slang: choose **+ New → Cubemap** and write `mainCubemap(out vec4 color, in vec2 fragCoord, in vec3 rayOri, in vec3 rayDir)`, then sample the result from a Buffer channel with a direction vector. Set **Face size** under **Output** (512 by default) and inspect the result as a **Face**, **Cross layout** or **Environment** preview. In `.sha.json`, set `"outputKind": "cubemap"` and `"faceSize"` on the pass. Slang can also fill cubemaps from compute with `cubemapDirection` and `writeOutput(pixel, face, color)`. A cubemap pass can read its own previous frame for feedback. WGSL cubemap buffers are not supported yet.
- New live inputs: **Webcam** and **Screen** in a channel's **Misc** tab, and **Mic** and **Shared Audio** (browser tab or system audio) in its **Audio** tab. Saved configs only record the type, such as `{ "type": "webcam" }`, `"microphone"`, `"screen"` or `"system-audio"`; device choices and permissions last for the session only. Live inputs need HTTPS or localhost and are greyed out in VS Code panels: use **Open in Browser** to use them with a shader from VS Code.
- Audio channels now use Shadertoy's analyser settings: a 2048-point FFT with 0.8 smoothing and a −100 to −30 dB range. Existing audio-reactive shaders may respond differently, because the spectrum row now covers about 0 to `iSampleRate / 4` Hz.
- New **Live** and **Render** modes for screenshots and video recording. **Live** captures the preview as it runs, without restarting it, and records until **Stop & save**. **Render** captures at a chosen time and resolution, first rendering every earlier frame so feedback buffers and `iFrame` match a continuous run. Render does not replay mouse, keyboard or live input.
- Recording only offers MP4 and WebM when your browser or VS Code can encode them. MP4 sizes are rounded up to even dimensions. The **FPS** list adds a **Screen** option. The GIF **Colors** option has been removed.
- Redesigned GPU storage for Slang and WGSL. Each storage buffer has its own card in the config panel, added with **+ New → Storage buffer**, with **Settings** and **Inspect** tabs. Settings can define numeric struct fields, start from a binary file of up to 256 KiB, clear the buffer every frame, keep its data across restarts, and **Reset data now**. Changes take effect when you click **Apply changes**. **Inspect** shows current values as a snapshot or live, read at **Latest values** or before or after a chosen pass. New `.sha.json` storage fields: `fields`, `initialData`, `initialDataName`, `clearEachFrame` and `resetOnRestart`.
- Config passes are now cards. Click a render pass's eye button to preview that pass's output with the shader's inputs, shown by a **Viewing** badge, or use **Preview this pass** from its right-click menu. **Preview file standalone** opens a buffer's file as a shader of its own. While inline rendering is active, the badge reads **Viewing · L24** and follows the debugged line.
- Buffer and compute passes have a new **Shader file** picker listing the files already used by the config, with **Browse workspace…**, **Create file…** and **Enter a path…**. Several passes can share one source file. **Open editor** opens the pass's file.
- The **Vertex shader** section now comes last in a pass's settings, after Resolution for Image and after Output for buffers.
- Opening a buffer, Common or vertex file linked to the current shader now keeps that shader's preview without locking it. Double-clicking a pass card no longer locks the preview. Use **Lock** to keep the preview while you edit unrelated shaders; hover over it to see what it will do.
- New debug settings now start with **Variable inspector** on and **Pixel inspector** and **Inline rendering** off. Saved profiles keep their choices. A line icon on the **Debug** tab shows when line rendering is on.
- Opening a different shader now resets the 3D viewer's orbit, pan and zoom. Editing or recompiling the current shader keeps the view.
- New VS Code settings `shader-studio.webgpu.useViewerCamera`, the default for **Use viewer camera** on mesh passes in GLSL, WGSL and Slang, and `shader-studio.webgpu.defaultRenderAuthoring`, which chooses Built-in hooks or Native entry points for new WGSL and Slang shaders. Standalone has the same choices in **Settings**.
- Shaders with no aspect ratio in their config now open at 16:9 instead of matching your screen. The **Auto** aspect ratio is now labelled **Screen**.
- Shader Explorer now updates its list and thumbnails when shader or `.sha.json` files are added, changed or deleted.
- Shader Explorer options moved to an **Explorer settings** panel (gear button) with **Display**, **Filters** and **Files** groups, a new **Hide vertex files** filter, and **Reset to defaults**.
- New **Only keep active shader files open** Explorer setting (`shader-studio.explorer.keepActiveShaderFiles` in VS Code, off by default there and on by default in standalone). Each preview opens its shader's main, buffer, Common and vertex files and closes other shader tabs, asking first about unsaved changes.
- New AI assistant connection (VS Code only): run **Shader Studio: Connect AI Assistant** and turn on **Enable AI connection** to let a local MCP-compatible assistant read and edit your shader files, check errors, capture images and short recordings, inspect storage values, control playback, and send input to an open preview. Edits stay unsaved for you to review. The connection is off by default, needs a trusted workspace, and uses a private token. It also adds the commands **Shader Studio: Regenerate MCP Token** and **Shader Studio: Verify MCP Connection**, and the `shader-studio.mcpEnabled` and `shader-studio.mcpPort` settings.
- Standalone works on phones and tablets: narrow windows switch to bottom navigation with **Explorer**, **Editor**, **Preview** and **Tools**. Turn off **Settings → Mobile mode** to keep the desktop layout at every size.
- Standalone can be installed with your browser's **Install** or **Add to Home Screen** and works offline. Use **Workspace → Prepare Offline Compilers** to make Slang and WGSL available offline.
- Standalone shows whether your work is **Saved** or **Session-only** and warns about storage limits. New **Workspace → Export Workspace Backup**, **Import Workspace Backup…** and **Request storage protection** commands.
- Standalone updates itself: when a new version is available, it saves your changes and reloads. Reloading while online always opens the latest version.
- New standalone **Files** pane (**View → Files**) to browse, filter, create, move, rename, delete and download workspace files and folders, with multi-select. Folders and multiple files download as one ZIP.
- Standalone can upload shaders, `.sha.json` configs and assets, using **Upload Files** or drag and drop. Channel pickers have **Upload…** and can choose any image, cubemap, volume, audio or video already in the workspace. Uploads stay in your browser and are included in workspace backups.
- New standalone workspaces keep starter files and new shaders at the top level instead of in a `/shaders` folder. Existing workspaces are left as they are.
- New standalone **Pixel** theme: choose **Settings → Theme → Style → Pixel**, in light or dark appearance.
- Standalone panels with a single tab hide their tab header until you hover over its top edge or a divider, or drag a panel.
- GLSL completion and navigation no longer read `#include` files, because the preview does not support `#include`. Put shared GLSL code in Common.
- Fixed paused, stopped or hidden previews with a video input keeping the GPU busy. Video frames are now uploaded only when the preview renders a frame and the video has moved.
- Fixed GLSL shaders sometimes failing with "Compile timed out" when the preview was in the background.
- Fixed quick config panel edits sometimes being undone by an older saved config that arrived late.
- Fixed the preview jumping back to the previous shader after you unlocked it with a Common or vertex file focused, then quickly opened another shader.
- Fixed a spurious config error for unsaved, untitled shader documents in VS Code.
- Fixed standalone tab context menus having a see-through background.

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
