# FAQ


## Is Shader Studio only for Shadertoy shaders?

It is optimized for Shadertoy-style fragment shaders using the `mainImage(out vec4 fragColor, in vec2 fragCoord)` signature and Shadertoy uniforms. Standard GLSL fragment shaders with a different entry point are not supported.

## Can I open multiple previews?

Yes. You can open multiple panels, separate windows, and browser tabs simultaneously. Each preview runs independently.

## How do I create a config file?

Run **Shader Studio: Generate Config for GLSL File** from the command palette, or click the **Config** button in the toolbar. See [Configure Buffers and Inputs](../features/config-buffers.md) for details.

## Can I debug intermediate values?

Yes. Enable [debug mode](../debugging/index.md) from the toolbar to visualize any variable line-by-line. You can also use the [variable inspector](../debugging/variable-inspector.md) to capture all in-scope variables at once with histograms and statistics.

## Does it support audio and cubemaps?

Yes. Bind an audio file as a channel input to get a 512×2 FFT/waveform texture, matching Shadertoy's audio format. Bind a T-cross cubemap image to use it as a `samplerCube`. See [Configure Buffers and Inputs](../features/config-buffers.md) and [Shadertoy Compatibility](shadertoy-compatibility.md).

## Can I edit code directly in the preview?

Yes. Toggle the [editor overlay](../features/editor-overlay.md) to write code on top of the shader preview with live recompilation. It supports GLSL syntax highlighting and optional Vim mode.

## Can I open my shader in a browser?

Start the [web server](../features/web-server.md) from the options menu and open the local URL in your browser. You can also use the copied URL on another device on the same network if needed.

## Can I use textures and videos as inputs?

Yes. Create a `.sha.json` config file and bind image or video files to `iChannel0–3`. See [Config File Format](config-file.md) for examples.

## What's the `.sha.json` file?

It's a shader configuration file that defines multi-pass rendering pipelines and input channel bindings. It opens in a visual editor by default. See [Config File Format](config-file.md).

## How do I lock the preview to one shader?

Click the <i class="codicon codicon-lock"></i> **Lock** button in the toolbar. The preview will stay on the current shader even as you browse other files.

## Can I export the shader output as a video or GIF?

Yes. Click the **Record** button in the toolbar (or **Menu → Export**) to open the recording panel. You can capture a screenshot (PNG/JPEG), a video (MP4 or WebM), or an animated GIF with configurable duration, FPS, and resolution. See [Recording](../features/recording.md).

## How do I change when the shader recompiles?

Open **Menu → Compile Mode** and choose from:
- **Hot** — recompile on every keystroke (default)
- **Save** — recompile only when you save the file
- **Manual** — recompile only when you press `Ctrl+Enter` or click **Compile Now**

See [Compile Modes](../features/compile-modes.md).

## How do I check shader performance?

Click the **FPS** display in the toolbar and enable **Frame Times** to open the performance monitor. It shows a scrollable, zoomable graph of frame timing history. See [Performance Monitor](../features/performance.md).

## Can I drive uniforms with code?

Yes. Add a `script` field to your `.sha.json` pointing to a TypeScript or JavaScript file. Export named values and they become custom uniforms in your shader, updated every frame. See [Config File Format](config-file.md#script-driven-uniforms).
