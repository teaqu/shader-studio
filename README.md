# Shader Studio

A GLSL fragment shader viewer for VS Code with hot reloading, designed specifically for Shadertoy-style shaders.

Docs: https://teaqu.github.io/shader-studio/

![screenshot](assets/screenshot.png)
![shader explorer screenshot](assets/shader-explorer.png)

## Installation
Install through VS Code extensions. Search for "Shader Studio".

[Visual Studio Code Market Shader Studio](https://marketplace.visualstudio.com/items?itemName=teaqu.shader-studio)

## Development

### Building the Extension

```bash
cd extension
npm run build
```

## Docs

https://teaqu.github.io/shader-studio/

Docs are in `/docs` and configured with MkDocs (`/mkdocs.yml`).

- Local build: `mkdocs build`
- Local preview: `mkdocs serve`

GitHub Pages deployment workflow is at `.github/workflows/docs.yml`.
