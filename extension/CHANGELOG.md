# Change Log
### Unreleased

- Fixed WGSL built-in uniforms such as `iResolution` and `iTime` being treated as shader declarations: they now show their documentation on hover, stay out of the document outline, and no longer take go-to-definition to the top of the file.
- WGSL hovers now read as WGSL declares things (`let uv: vec2f`, `var<storage, read> values: array<f32>`, `struct Material`, `fn scale(amount: f32, by: f32) -> f32`), and a function's leading comment appears with it.
- WGSL attributes such as `@compute`, `@workgroup_size` and `@builtin` are now documented on hover.
- Fixed WGSL variable capture reporting nothing while the file holds a statement that does not parse; as in GLSL and Slang, values declared above the break are captured.
- Fixed WGSL capture omitting a block's values on its closing brace, and never capturing a `for (var i = 0; ...)` loop counter.
- Documented that assigning to a swizzle (`position.xy = ...`) needs the optional `swizzle_assignment` WGSL language feature, which the Chromium inside VS Code does not have yet.

- Fixed delayed preview selection and stale host echoes resetting the cursor and splitting typed text in editors sharing the same shader.

- Fixed standalone Hide Buffers preferences being lost when reloading during workspace saves.
- Fixed signature help disappearing when a pending editor save refreshes the standalone workspace, including nested WGSL calls.
- Fixed detached GLSL/WGSL editors inheriting another preview's Common authoring context.
- Fixed the WGSL variable inspector hiding locals derived from channel samples, and listing module globals and script uniforms as captured variables; like Slang it now shows only the function's parameters and locals.
- The debug panel's Uniforms section now lists only built-in uniforms in every language; script values stay in the config panel's Script tab.
- Fixed WebGPU variable capture failing with unresolved script uniforms when it ran before a script-driven shader's first compile finished.

- Breaking: Slang channel objects are now direct globals. Replace
  `inputs.albedo.Sample(uv)` with `albedo.Sample(uv)` and use direct metadata
  such as `albedo.size`; the `.sha.json` `inputs` field is unchanged.
- Added first-class WGSL shader support: `.wgsl` authoring with syntax highlighting, snippets, and diagnostics, a `mainImage` image pipeline on WebGPU, free-function channel accessors, a `ptr<function, …>` vertex hook, storage/compute passes, script-pass uniforms, `enable`/`requires` directive hoisting, plan-based step debugging with the variable inspector (including type inference for unannotated locals), and WGSL sections in the Channels, Vertex Shaders, and configuration docs plus a new WGSL Shaders guide.

- Fixed editor navigation losing pending source edits, applying delayed edits to the wrong file, or leaving completions attached to the previous file.
- Fixed standalone selection changes being lost on an immediate reload.
- Fixed WGSL entry-point detection for shaders that use Common helpers.
- Fixed unhandled word-highlighting cancellations when switching editor files.

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
- Added a toggleable canvas marker for the locked pixel inspector position, with the preference persisted across sessions.

### 1.0.1
- Fixed extension activation in published installs when the script bundler dependency is not present in the VSIX.

### 1.0.0
- First stable release of Shader Studio.
- Live Shadertoy-style GLSL previews in VS Code panels, external windows, and browsers.
- Visual configuration editor for multi-pass shaders with textures, video, audio, cubemaps, buffers, keyboard input, and common/script passes.
- Visual debugging tools including pixel inspection, inline rendering, variable capture, normalization, loop controls, and parameter controls.
- Monaco editor overlay with compile modes, shader locking, panel layout persistence, and profile management.
- Shader Explorer, snippet library, time controls, recording, resolution controls, camera uniforms, and performance tooling.
- Improved documentation, marketplace assets, and release packaging for VS Code Marketplace, Open VSX, and GitHub Releases.

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
- Added video input support (including schema, config, and UI updates)
- Added common buffer
- Better error handling
- Bug fixes

### 0.0.8
- Shader Explorer
- HW_PERFORMANCE
- bug fixes

### 0.0.7
- Electron install fix all platforms

### 0.0.6
- Electron install fix on macos
- Run based on file extension not just language id
- Recomend syntax highlighter

### 0.0.5
- Create default shader from menu

### 0.0.4
- Electron fix

### 0.0.3
- Fixed custom websocket port
- Fixed render loop breaking on error

### 0.0.2
- Changed config UI to act like a markdown preview.
- Rendering now independent of Svelte UI.
- More docs in extension readme.
- Fixed locked shader not refreshing to new file on unlock.
- Fixed JSON not updating when changing texture config on the UI.
- Fixed shader breaking on invalid config.
- Fixed electron icon and title bar on macOS.

### 0.0.1
- Initial release
