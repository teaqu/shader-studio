# Standalone Mode

[Open Shader Studio in your browser](https://teaqu.github.io/shader-studio/app/) to edit and preview shaders without installing VS Code or running the extension.

!!! warning "Alpha"
    Standalone mode is in alpha and has bugs and missing features compared with the VS Code extension. Your workspace is saved only in this browser. Clearing browser data deletes it.

## Install and Offline Use

On supported browsers, use the browser's **Install** or **Add to Home Screen** command to add Shader Studio to your device. The first online launch caches the GLSL application shell and bundled examples. To make the larger Slang/WGSL compiler assets available offline, open **Workspace → Prepare Offline Compilers** and wait until the header says **Ready offline**. A first-ever offline visit cannot install the app.

Your workspace remains stored in this browser; it is not synced between devices. **Saved** means the latest write committed to IndexedDB. **Session-only** means browser storage is unavailable and the current work will not survive closing the app. **Protect local storage** asks the browser for best-effort eviction protection; clearing site data still removes local work. Use **Workspace → Export Workspace Backup** regularly and **Import Workspace Backup…** to restore a validated backup. Import always asks before replacing the current workspace.

When **Update ready** appears, Shader Studio has downloaded a complete compatible build. Accepting it first flushes pending workspace edits and only then activates and reloads. Use **Workspace → Check for Updates** to check manually. Cache updates never delete the IndexedDB workspace.

## Get Started

1. Open the standalone app and select an example in **Shader Explorer**.
2. Edit the shader in the **Editor** pane and watch the **Preview** update. The default **Hot** compile mode recompiles as you type.
3. To start your own shader, click **New Shader** in Shader Explorer, enter a unique name, choose **GLSL**, **Slang**, or **WGSL**, and click **Create Shader**.
4. Open **Config** in the preview toolbar to add buffer passes, channels, or uniforms.

Slang and WGSL require WebGPU support in your browser and device. The examples include all three languages, shaders using the bundled texture and cubemap, and **particle-swarm.wgsl**, which drives 16384 particles from WGSL [compute passes](features/compute.md) and storage buffers. Drag in its preview to pull the swarm towards the pointer.

See the [Quick Start](quick-start.md#step-3-write-your-shader) for example shader code and [Configure Buffers and Inputs](features/config-buffers.md) for pass configuration. Instructions that refer to VS Code commands or workspace files apply to the extension.

## Arrange Your Workspace

The workspace contains Shader Explorer, Editor, and Preview panels. Drag tabs to rearrange or split them, and drag the dividers to resize them. Use the top **View** menu to show or hide each panel.

The preview has its own controls for configuration, debugging, performance, and recording. Use **Workspace → Reset workspace layout** to restore the outer workspace arrangement. Use the preview's **Layout** menu to reset the viewer layout separately.

On phones, the bottom navigation shows one main destination at a time: **Explorer**, **Editor**, **Preview**, or **Tools**. Tools includes **Config**, **Debug**, **Frame Times**, and **Export** and remembers the last selection. The Preview editor overlay remains available from its Editor Overlay menu. Rotating the device or returning to a larger viewport does not replace the saved desktop Dockview layout.

## Saving and Browser Storage

Shader edits and configuration changes are saved in this browser. Reloading the app restores that workspace when storage is available. These files are not written to a folder on your computer and are not synced to VS Code, another browser, or another device. The hosted app and a local development server have separate storage.

If browser storage is unavailable, changes in that session will not survive a reload. Keep a separate copy of important shader source and configuration before clearing site data or changing browsers.

**Workspace → Clear Workspace** asks for confirmation, removes the standalone workspace and its saved settings, then reloads the app with the starter examples. This cannot be undone. Resetting the workspace layout only changes the panel arrangement.

Screenshots and recordings are saved as browser downloads.

Workspace-root `@/` shader paths are supported and
resolve from `/` in the virtual workspace.

## Run Locally from Source

From the repository root, install dependencies and start the standalone app:

```bash
npm install
npm run dev:standalone
```

Open the local URL printed by Vite. This opens your local standalone workspace.

To build and preview the static app:

```bash
npm run build:standalone
npm run preview -w @shader-studio/standalone
```

The build output is in `standalone/dist/`. Serve it over HTTP locally or HTTPS when hosting it; opening the HTML file directly is not the supported workflow.

Run the phone and offline browser regressions with:

```bash
npm run test:e2e -w @shader-studio/standalone -- --project=mobile-chromium
npm run test:e2e -w @shader-studio/standalone -- --project=chromium pwa.e2e.mjs
```

Browser emulation does not validate installation, software-keyboard behavior, selection handles, safe areas, background eviction, or GPU capability on a real phone. Follow the [mobile device acceptance checklist](mobile-testing.md) before promoting the mobile branch.

## Not yet supported

- Script passes and their custom uniforms.
- Model geometry assets.
- Slang imports/includes.
- Local workspace asset selection. The asset picker currently offers the bundled texture and cubemap.

Use the VS Code extension for these features.
