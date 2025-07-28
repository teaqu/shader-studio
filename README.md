# shader-view

A GLSL fragment shader viewer for VS Code with hot reloading, designed specifically for Shadertoy-style shaders.

![screenshot](assets/screenshot.png)

## Project Structure

- `/extension/` - VS Code extension
- `/ui/` - User interface including shader rendering components
- `/config-ui/` - UI for editing json config
- `/electron/` - Dedicated window for UI

## Development

### Building the Extension

```bash
cd extension
npm run build
```

# Usage
See the Extension's [README](/extension/README.md).