# Quick Start


## Step 1: Install

1. Open VS Code and go to the **Extensions** panel (`Cmd+Shift+X` / `Ctrl+Shift+X`).
2. Search for **Shader Studio** and click **Install**.

Or install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=teaqu.shader-studio).

## Step 2: Open a Preview


1. Click the <img src="../assets/shader-studio-icon.svg" width="16" height="16" style="vertical-align:middle;"> **Shader Studio** icon in the status bar and choose **Open Panel** (or **Open Window** for a separate window).
2. Either open an existing `.glsl` file, or click **☰ menu → New Shader** to create one from a template.

Your shader preview updates live as you edit. Any save or keystroke triggers a recompile.

## Step 3: Write Your Shader

Shader Studio runs Shadertoy-style shaders. Your shader needs a `mainImage` function. If you created your shader with the **New Shader** button, you should see something like this:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0);
}
```

!!! note "New to shaders or Shadertoy?"
    A shader is a small program that runs on your GPU. Instead of looping over pixels in code, the GPU runs `mainImage` **once per pixel, in parallel**, every frame.

    The code above breaks down like this:

    - `fragCoord` — the current pixel's position on screen in pixels
    - `iResolution` — the canvas size; dividing gives `uv`, a 0–1 position across the screen
    - `fragColor` — the color you output, as `vec4(red, green, blue, alpha)` where each channel is 0–1
    - `iTime` — seconds elapsed since the shader started, useful for animation

    Shader Studio also provides `iMouse` (mouse position) and other uniforms that match the [Shadertoy](https://www.shadertoy.com) API, so shaders from that site will generally work here too.

    [Watch this video by The Art of Code](https://www.youtube.com/watch?v=u5HAYVHsasc) for a good beginner's introduction.

## Step 3: Use the Toolbar

The preview toolbar gives quick access to all features:

- <i class="codicon codicon-play"></i> / <i class="codicon codicon-debug-pause"></i> **Play/Pause** — freeze or resume animation
- **Time** — scrub, loop, and control playback speed
- **FPS** — click to set frame rate limit or open the performance monitor
- **Resolution** — click to change scale, aspect ratio, zoom, or set a custom resolution
- <i class="codicon codicon-bug"></i> **Debug** — enable line-by-line visual debugging
- <i class="codicon codicon-code"></i> **Editor** — toggle inline code editing overlay
- <i class="codicon codicon-gear"></i> **Config** — set up buffers, inputs, and uniforms
- <i class="codicon codicon-device-camera"></i> **Record** — take a screenshot or record video/GIF
- <i class="codicon codicon-menu"></i> **Menu** — access shader explorer, snippets, compile mode, browser preview, and settings

See [Interface Tour](interface-tour.md) for a full breakdown.

## Add Channels and Buffers

Click the **Config** button in the toolbar to set up buffer passes, input channels, and uniforms for your shader. Configuration is stored in a `.sha.json` file that's generated automatically when needed.

See [Configure Buffers and Inputs](features/config-buffers.md) for the full guide.

## Locking a Shader

When working with multi-buffer shaders, opening a buffer file will switch the preview to that buffer. Use the <i class="codicon codicon-lock"></i> **Lock** button in the toolbar to keep the preview pinned to a specific shader — it will stay locked even as you navigate between buffer files to edit them.

## Tips

- If nothing renders, check that your shader has the `mainImage` signature above — it's required.
- If you see errors, check the tooltip near the play/pause button for the compilation error message.

## Next

[Interface Tour](interface-tour.md) — learn the preview controls before moving into shader workflows.
