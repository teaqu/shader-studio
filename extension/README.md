# Shadera

A GLSL fragment shader viewer for VS Code with hot reloading, designed specifically for Shadertoy-style shaders.

![screenshot](https://raw.githubusercontent.com/teaqu/shadera/refs/heads/main/assets/screenshot.png)

You an either spawn in a new window, a vscode panel or in your browser.

Click the SS icon on the VSCode status bar to see the options.

## Configuration

### Shader Configuration Files

Add config same dir as shader like so: shadername.sha.json. You can also do it
via the command.

The extension provides a visual editor for `.sha.json` files. Click the UI button
in the status bar to show.

![config screenshot](https://raw.githubusercontent.com/teaqu/shadera/refs/heads/main/assets/config-screenshot.jpg)

### Example Configuration Format

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

## Supported from Shadertoy

Currently supports uniforms:

- `iTime` - shader playback time (in seconds)
- `iTimeDelta` - render time (time since last frame, in seconds)
- `iFrameRate` - shader frame rate (frames per second)
- `iFrame` - shader playback frame number
- `iMouse` - mouse pixel coordinates
- `iResolution` - viewport resolution (in pixels)
- `iChannel0-3` - input channels (textures, buffers, keyboard)
- `iDate` - current date (year, month, day, time in seconds)

## Not Yet Supported

- Common Buffer
- `iChannelTime[4]` - channel playback time (for video inputs)
- `iChannelResolution[4]` - channel resolution for each input
- `samplerCube iChannelX` - cubemap texture support
- `iSampleRate` - sound sample rate (typically 44100)
- Video texture inputs
- Audio/sound inputs
- Webcam inputs
- Volume/microphone inputs
- VR/AR inputs
