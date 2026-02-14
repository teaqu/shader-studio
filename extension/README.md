# Shader Studio

A GLSL fragment shader viewer for VS Code with hot reloading, designed specifically for Shadertoy-style shaders. See https://www.shadertoy.com for more information on the format and to see some cool shaders.

![screenshot](https://raw.githubusercontent.com/teaqu/shader-studio/refs/heads/main/assets/screenshot.png)
![shader explorer screenshot](https://raw.githubusercontent.com/teaqu/shader-studio/refs/heads/main/assets/shader-explorer.png)

https://marketplace.visualstudio.com/items?itemName=slevesque.shader is recomended for synax highlighting.

## Quick Start

1. Open any shadertoy style `.glsl` file in VS Code
2. Click the SHA icon on the VS Code status bar to see the viewing options

![shader studio menu button](https://github.com/teaqu/shader-studio/blob/main/assets/sha-button.png?raw=true)

You can launch as many panels, windows, or browser tabs as you want simultaneously.

![shader studio menu](https://github.com/teaqu/shader-studio/blob/main/assets/menu-options.png?raw=true)

## Viewing Modes

### Panel

This runs the shader within a panel in VS Code, allowing you to view your shader alongside your code.

### Web Browser

For the best performance, it's recommended to use your web browser. Web browsers appear to have better GPU optimizations and can achieve higher priority rendering than observed in VS Code panels.

## Runtime Config

If you click on the resolution on the menubar there are some options to change how the shader is displayed.

<img src="https://github.com/teaqu/shader-studio/blob/main/assets/runtime-config.png?raw=true" alt="shader runtime config" width="250"/>

## Time Controls

Click on the time display in the menu bar to access playback controls:

- **Time Scrubbing**: Use the slider to seek to any point in time within the current range
- **Time Range Presets**: Quickly set the time range to 2π, 10s, 30s, 1m, or 2m (default: 1m)
- **Loop Mode**: Toggle looping to repeat the shader from 0 to the selected time range
- **Playback Speed**: Adjust shader speed from 0.25× to 4× (presets: 0.25×, 0.5×, 1×, 2×, 4×)

The time controls allow you to:
- Scrub through your shader's animation to find the perfect moment
- Loop a specific time range to focus on a particular animation segment
- Slow down or speed up playback to observe shader behavior in detail

## Configuration

If you want to use buffers or include textures, you can do so by creating a corresponding `.sha.json` config file for your `.glsl` shader. See [my shaders repository](https://github.com/teaqu/shaders/tree/main/shadertoy) for examples using this format.

The config file should be in the same directory as your shader with the naming convention: `shadername.sha.json`. You can also generate a config file using the command palette.

![generate config](https://github.com/teaqu/shader-studio/blob/main/assets/generate-glsl-config.png?raw=true)

The extension provides a visual editor for `.sha.json` files. Click the preview button (same as a markdown file) to open the visual editor:

![Config UI View](https://github.com/teaqu/shader-studio/blob/main/assets/config-ui.png?raw=true)

The passes are `Image`, `BufferA`, `BufferB`, `BufferC`, and `BufferD`.
Each pass has inputs that are tied to uniforms `iChannel0`, `iChannel1`, `iChannel2`, and `iChannel3`. These channels can read from other buffers, keyboard input, or textures.

### Example Configuration Format

Here's an example of the configuration format.


```json
{
  "version": "1.0",
  "passes": {
    "Image": {
      "inputs": {
        "iChannel0": {
          "source": "BufferA",
          "type": "buffer"
        }
      }
    },
    "BufferA": {
      "path": "buffer_name.glsl",
      "inputs": {
        "iChannel0": {
          "source": "BufferA",
          "type": "buffer"
        },
        "iChannel1": {
          "type": "keyboard"
        }
      }
    }
  }
}
```

## Debugging (Experemental)

Shader Studio can transpile your GLSL shader code into JavaScript (using https://github.com/stackgl/glsl-transpiler). This allows you to use the standard VS Code debugger to step through your shader code, inspect variables, and understand its execution flow.

To use this feature, open a `.glsl` file and run the command "Shader Studio: Transpile GLSL to JavaScript (for debugging)" from the command palette. This will generate a `[shader-name].transpiled.js` file. You can then set breakpoints in this JavaScript file and start a debugging session (e.g., using Node.js).

This can be used in conjunction with the pixel inspector. Get the values from that and then update the js uniforms.

<img width="477" height="291" alt="image" src="https://github.com/user-attachments/assets/493ebc29-0ae5-49ca-95a9-cf8aac4ddace" />

## Shadertoy Compatibility

The aim is to support all Shadertoy features. Currently, the extension supports the following uniforms:

### Currently Supported

- `iTime` - shader playback time (in seconds)
- `iTimeDelta` - render time (time since last frame, in seconds)
- `iFrameRate` - shader frame rate (frames per second)
- `iFrame` - shader playback frame number
- `iMouse` - mouse pixel coordinates
- `iResolution` - viewport resolution (in pixels)
- `iChannel0-3` - input channels (textures, buffers, keyboard)
- `iChannelResolution[4]` - channel resolution for each input (vec3: width, height, depth)
- `iDate` - current date (year, month, day, time in seconds)
- Video Inputs
- Common Buffer

### Not Yet Supported

- `iChannelTime[4]` - channel playback time (for video inputs)
- `samplerCube iChannelX` - cubemap texture support
- `iSampleRate` - sound sample rate (typically 44100)
- Audio/sound inputs (including video audio)
- Webcam inputs
- Volume/microphone inputs
- VR/AR inputs

## Contributing

Found a bug or want to contribute? Visit the [GitHub repository](https://github.com/teaqu/shader-view) to report issues or submit pull requests.
