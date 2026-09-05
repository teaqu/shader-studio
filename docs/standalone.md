# Standalone Mode

[Open Shader Studio in your browser](https://teaqu.github.io/shader-studio/app/) to edit and preview shaders without installing VS Code or running the extension.

!!! warning "Alpha"
    Standalone mode is in alpha and has bugs and missing features compared with the VS Code extension. Your workspace is saved only in this browser. Clearing browser data deletes it.

## Get Started

1. Open the standalone app and select an example in **Shader Explorer**.
2. Edit the shader in the **Editor** pane and watch the **Preview** update. The default **Hot** compile mode recompiles as you type.
3. To start your own shader, click **New Shader** in Shader Explorer, enter a unique name, choose **GLSL** or **Slang**, and click **Create Shader**.
4. Open **Config** in the preview toolbar to add buffer passes, channels, or uniforms.

GLSL uses the WebGL renderer; Slang uses WebGPU and requires WebGPU support in your browser and device. The examples include both languages and shaders using the bundled texture and cubemap.

See the [Quick Start](quick-start.md#step-3-write-your-shader) for example shader code and [Configure Buffers and Inputs](features/config-buffers.md) for pass configuration. Instructions that refer to VS Code commands or workspace files apply to the extension.

## Arrange Your Workspace

The workspace contains Shader Explorer, Editor, and Preview panels. Drag tabs to rearrange or split them, and drag the dividers to resize them. Use the top **View** menu to show or hide each panel.

The preview has its own controls for configuration, debugging, performance, and recording. Use **Workspace → Reset workspace layout** to restore the outer workspace arrangement. Use the preview's **Layout** menu to reset the viewer layout separately.

## Saving and Browser Storage

Shader edits and configuration changes are saved to a virtual workspace in browser storage (IndexedDB). Reloading the app restores that workspace when storage is available. These files are not written to a folder on your computer and are not synced to VS Code, another browser, or another device. The hosted app and a local development server have separate storage.

If IndexedDB is unavailable or cannot be opened, the app falls back to memory; changes in that session will not survive a reload. Keep a separate copy of important shader source and configuration before clearing site data or changing browsers.

**Workspace → Clear Workspace** asks for confirmation, removes the standalone workspace and its saved settings, then reloads the app with the starter examples. This cannot be undone. Resetting the workspace layout only changes the panel arrangement.

The asset picker does not browse files on your computer. You can use the bundled texture and cubemap, but local workspace asset selection is not available in standalone mode. Screenshots and recordings are saved as browser downloads.

## Standalone or Open in Browser?

| | Standalone mode | Extension's Open in Browser |
|---|---|---|
| Start | Open the standalone app | Start the web server from VS Code |
| Requires VS Code running | No | Yes |
| Shader files | Browser workspace | Files managed by the extension |
| Connection | Runs in the browser | Connects to the extension's local server |

To preview your existing VS Code workspace in a browser, follow [Open in Browser](features/web-server.md).

## Run Locally from Source

From the repository root, install dependencies and start the standalone app:

```bash
npm install
npm run dev:standalone
```

Open the local URL printed by Vite. This starts the standalone workspace; no extension web server is needed.

To build and preview the static app:

```bash
npm run build:standalone
npm run preview -w @shader-studio/standalone
```

The build output is in `standalone/dist/`. Serve it over HTTP locally or HTTPS when hosting it; opening the HTML file directly is not the supported workflow.
