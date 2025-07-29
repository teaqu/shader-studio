# Shadera

A GLSL fragment shader viewer for VS Code with hot reloading, designed specifically for Shadertoy-style shaders.

![screenshot](assets/screenshot.png)

## Installation
Install through VS Code extensions. Search for "Shadera".

[Visual Studio Code Market Shadera](https://marketplace.visualstudio.com/items?itemName=teaqu.shadera)

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