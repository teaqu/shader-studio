# Configure Buffers and Inputs


## Goal

Set up multi-pass rendering and input channels using `.sha.json` config files.

## Step 1: Generate a Config

1. Open the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).
2. Run **Shader Studio: Generate Config for GLSL File**.
3. The generated `yourShader.sha.json` opens in the visual config editor.

You can also click the **Config** button  in the toolbar to open the config panel.

![Config editor with buffer tabs](../assets/placeholders/template.svg)
_Placeholder: `workflow-config-panel.png` — Visual config editor showing Image and BufferA tabs, with iChannel0 bound to BufferA as a buffer input._

## Step 2: Add Passes

Click **+ New** in the tab bar to add:

- **Buffer** — creates a new render pass (BufferA through BufferD)
- **Common** — shared GLSL code included in all passes

Each buffer pass needs a `.glsl` file path. If the file doesn't exist, the editor offers a button to create it.

## Step 3: Configure Inputs

For each pass, add input channels by clicking **Add Channel**:

| Input Type | Description | Example |
|------------|-------------|---------|
| **Buffer** | Read another pass's output | BufferA reads its own previous frame for feedback effects |
| **Texture** | Bind an image file | Noise texture, photo, gradient |
| **Video** | Bind a video file | Timelapse, recorded footage |
| **Audio** | Bind an audio file | Music-reactive shaders with FFT data |
| **Cubemap** | Bind a cubemap image | Environment maps, skyboxes |
| **Keyboard** | Key state input | Game controls, interactive toggles |

Channels are bound to `iChannel0` through `iChannel3` and accessed in GLSL as `texture(iChannelN, uv)`.

## Step 4: Validate

- Config file must share the same base name as the shader (`name.glsl` + `name.sha.json`)
- Both files should be in the same directory
- Referenced buffer `.glsl` files must exist
- Refresh the preview if changes don't apply immediately

## Common Patterns

### Feedback / Trails

BufferA reads its own previous frame:

```json
"BufferA": {
  "path": "bufferA.glsl",
  "inputs": {
    "iChannel0": { "source": "BufferA", "type": "buffer" }
  }
}
```

### Post-Processing

Image reads from BufferA (the main scene), then applies effects:

```json
"Image": {
  "inputs": {
    "iChannel0": { "source": "BufferA", "type": "buffer" }
  }
}
```

### Texture Lookup

Bind a noise texture for procedural generation:

```json
"Image": {
  "inputs": {
    "iChannel0": { "path": "textures/noise.png", "type": "texture" }
  }
}
```

### Audio Reactive

Bind an audio file. The channel texture contains FFT data (row 0) and waveform data (row 1):

```json
"Image": {
  "inputs": {
    "iChannel0": {
      "type": "audio",
      "path": "music/track.mp3"
    }
  }
}
```

Access in your shader:

```glsl
float bass = texture(iChannel0, vec2(0.05, 0.25)).r;  // low-frequency FFT bin
float wave = texture(iChannel0, vec2(uv.x, 0.75)).r;   // waveform
```

Use the **Music** tab in the channel config to set a loop region, adjust volume, and preview playback.

### Cubemap / Environment Map

Bind a T-cross layout cubemap image:

```json
"Image": {
  "inputs": {
    "iChannel0": {
      "type": "cubemap",
      "path": "textures/skybox.png"
    }
  }
}
```

In your GLSL, sample it as a `samplerCube`:

```glsl
vec4 sky = texture(iChannel0, normalize(rayDir));
```

## Next

[Shader Explorer](shader-explorer.md) — browse and open shaders across your workspace.
