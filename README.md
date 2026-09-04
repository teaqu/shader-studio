# Shader Studio

A GLSL and Slang shader viewer for VS Code with hot reloading. Edit Shadertoy-style GLSL fragment shaders or write Slang shaders for the WebGPU pipeline — both with live preview, multi-pass pipelines, and visual debugging.

Marketplace: https://marketplace.visualstudio.com/items?itemName=teaqu.shader-studio  
Docs: https://teaqu.github.io/shader-studio/

![screenshot](assets/screenshot.png)
![shader explorer screenshot](assets/shader-explorer.png)

## Installation
Install through VS Code extensions. Search for "Shader Studio".

[Visual Studio Code Market Shader Studio](https://marketplace.visualstudio.com/items?itemName=teaqu.shader-studio)

## Development

### Building the Extension

This repository is an npm workspace managed with Turborepo. Run build commands
from the repository root unless a command says otherwise.

Prerequisites:

- Node.js 18 or newer
- npm 9 or newer

Install dependencies:

```bash
npm install
```

Build everything needed by the VS Code extension:

```bash
npm run build
```

That command builds the UI packages, copies their compiled assets into the
extension package, and then builds the extension host code.

Useful targeted builds:

```bash
npm run build:types
npm run build:ui
npm run build:shader-explorer
npm run build:extension
```

For extension packaging work, run the extension package script:

```bash
cd extension
npm run build
```

To create a `.vsix` package locally:

```bash
cd extension
npm run vsce-package
```

### Performance Instrumentation

Both rendering engines can report what they are doing, for comparing the WebGL
and WebGPU paths in the environment a user actually runs them in. Set the flag
in the preview's console:

```js
window.__shaderPerf = true
```

In a VS Code webview, reach that console with **Developer: Open Webview
Developer Tools**, then switch the console's context to the shader-studio
frame. Each engine then logs its GPU adapter, the canvas backing store, and —
once per 120 frames — frame rate, main-thread cost, frame pacing
(`gapMsP50`/`gapMsP95`/`gapMsMax`, plus a `hitches` count of frames arriving
late) and JS heap size. Averages hide judder, so read the pacing fields rather
than `fps` when chasing a stutter.

Set `window.__slangPerf = true` *before* switching to a Slang shader to add
adapter, device, worker and per-pass compilation timings for that switch.

## Docs

https://teaqu.github.io/shader-studio/

Docs are in `/docs` and configured with MkDocs (`/mkdocs.yml`).

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r docs/requirements.txt
```

- Local build: `mkdocs build`
- Local preview: `mkdocs serve`

GitHub Pages deployment workflow is at `.github/workflows/docs.yml`.
