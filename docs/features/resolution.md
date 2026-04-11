# Resolution

This page uses three resolution terms:

- **Config Resolution**: the Image pass resolution saved in the shader config
- **Session Resolution**: temporary toolbar overrides for the current session
- **Live Render Resolution**: the final render size currently driving the canvas and debug tools

The **Resolution** display in the preview toolbar shows the current canvas dimensions.

Click it to open the resolution menu:

![Resolution menu](../assets/placeholders/template.svg)
_Placeholder: `interface-resolution-menu.png` — Resolution menu expanded with scale, custom size, aspect ratio, black background, and zoom controls._

- **Scale presets**: 0.25x, 0.5x, 1x, 2x, 4x
- **Custom resolution**: Enter a width and height in pixels
- **Aspect Ratio**: 16:9, 4:3, 1:1 (square), Fill (full space), Auto (responsive)
- **Black background**: Force a black canvas background
- **Zoom**: Slider from 0.1x to 3.0x

The toolbar always shows the **Live Render Resolution** currently driving the preview canvas.

- Changing **scale**, **custom resolution**, or **aspect ratio** here updates the **Session Resolution** immediately.
- If debug mode is enabled, **inline rendering** and the **variable inspector** refresh against the new live resolution immediately.
- **Scale still applies when custom resolution is set**. For example, `320 × 180` at `2x` renders at `640 × 360`.
Changes made here override the **Config Resolution** for the current session. The override stays active for the current shader until you reset it or switch to a different shader. When you switch shaders, the **Session Resolution** resets to whatever that shader's **Config Resolution** specifies, or the Shader Studio defaults if no config exists. To make a setting persist, save it in the [Config panel](config-buffers.md#the-image-pass) Image tab.
