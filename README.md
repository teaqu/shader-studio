# shader-view README

Shadertoy extension for vscode.

## Project Structure

- `/extension/` - VS Code extension source code
- `/ui/` - Svelte-based UI for the shader viewer

## Configuration

Add config same dir as shader like so: shadername.config.json

```json
{
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
```

Currntly supports uniforms iTime, iFrame, iMouse and iResolution.
