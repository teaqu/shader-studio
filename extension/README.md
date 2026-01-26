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

### Window

This mode is convenient as it runs independently of VS Code and also has the ability to stay on top of other windows.

The window mode provides additional options such as setting the window theme, reloading, and more.

<img src="https://github.com/teaqu/shader-studio/blob/main/assets/window-options.png?raw=true" alt="shader studio window options" width="250"/>

### Web Browser

For the best performance, it's recommended to use your web browser. Web browsers appear to have better GPU optimizations and can achieve higher priority rendering than observed in VS Code panels or Electron windows.

## Runtime Config

If you click on the resolution on the menubar there are some options to change how the shader is displayed.

<img src="https://github.com/teaqu/shader-studio/blob/main/assets/runtime-config.png?raw=true" alt="shader runtime config" width="250"/>

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
- `iDate` - current date (year, month, day, time in seconds)
- Video Inputs
- Common Buffer

### Not Yet Supported

- `iChannelTime[4]` - channel playback time (for video inputs)
- `iChannelResolution[4]` - channel resolution for each input
- `samplerCube iChannelX` - cubemap texture support
- `iSampleRate` - sound sample rate (typically 44100)
- Audio/sound inputs (including video audio)
- Webcam inputs
- Volume/microphone inputs
- VR/AR inputs

## Debugging (Experemental)

Shader Studio can transpile your GLSL shader code into JavaScript (using https://github.com/stackgl/glsl-transpiler). This allows you to use the standard VS Code debugger to step through your shader code, inspect variables, and understand its execution flow.

To use this feature, open a `.glsl` file and run the command "Shader Studio: Transpile GLSL to JavaScript (for debugging)" from the command palette. This will generate a `[shader-name].transpiled.js` file. You can then set breakpoints in this JavaScript file and start a debugging session (e.g., using Node.js).

## Contributing

Found a bug or want to contribute? Visit the [GitHub repository](https://github.com/teaqu/shader-view) to report issues or submit pull requests.
