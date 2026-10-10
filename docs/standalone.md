# Standalone Mode

[Open Shader Studio in your browser](https://teaqu.github.io/shader-studio/app/) to edit and preview shaders without installing VS Code or running the extension.

!!! warning "Alpha"
    Standalone mode is in alpha and has bugs and missing features compared with the VS Code extension. Your workspace is saved only in this browser. Clearing browser data deletes it.

## Install and Offline Use

On supported browsers, use the browser's **Install** or **Add to Home Screen** command to add Shader Studio to your device. The first online launch caches the GLSL application shell and bundled examples. To make the larger Slang/WGSL compiler assets available offline, open **Workspace → Prepare Offline Compilers** and wait until the header says **Ready offline**. A first-ever offline visit cannot install the app.

Your workspace saves automatically in this browser; it is not synced between devices. **Saved** means the latest write committed to IndexedDB. **Session-only** means browser storage is unavailable and the current work will not survive closing the app. The app requests browser storage protection automatically once when supported and not already granted, remembering the attempt so a declined request is not repeated on later launches. If that preference cannot be saved, requests stay manual. If the browser declines, saving still works; **Workspace → Request storage protection** lets you retry. A small warning icon beside the cloud and save status indicates unprotected or session-only storage. Hover for the explanation, or click the icon to open the Workspace menu and its backup actions. The Workspace menu always explains the current protection status. Protection reduces automatic removal when storage space runs low; clearing site data still removes local work. Use **Workspace → Export Workspace Backup** regularly and **Import Workspace Backup…** to restore a validated backup. Import always asks before replacing the current workspace.

Shader Studio checks for updates when you open or return to the app and when the connection comes back online. Once a complete compatible build has downloaded, it saves pending editor text and queued workspace changes, activates the update, and saves again before reloading. Editing pauses briefly during this process. Updates wait while another app tab is open or the workspace uses session-only storage. If saving fails, the current app stays open and the update retries after saving recovers. You can also use **Workspace → Check for Updates** to check immediately. Cache updates never delete the IndexedDB workspace.

## Get Started

1. Open the standalone app and select an example in **Shader Explorer**.
2. Edit the shader in the **Editor** pane and watch the **Preview** update. The default **Hot** compile mode recompiles as you type.
3. To start your own shader, click **New Shader** in Shader Explorer, enter a unique name, choose **GLSL**, **Slang**, or **WGSL**, and click **Create Shader**. WGSL/Slang start in the configured **Default shader mode**; you can choose Built-in or Native for this shader.
4. Open **Config** in the preview toolbar to add buffer passes, channels, or uniforms.

Slang and WGSL require WebGPU support in your browser and device. The examples include all three languages, shaders using the bundled texture and cubemap, and **particle-swarm.wgsl**, which drives 16384 particles from WGSL [compute passes](features/compute.md) and storage buffers. Drag in its preview to pull the swarm towards the pointer.

See the [Quick Start](quick-start.md#step-3-write-your-shader) for example shader code and [Configure Buffers and Inputs](features/config-buffers.md) for pass configuration. Instructions that refer to VS Code commands or workspace files apply to the extension.

## Configure Sources and Outputs

Image always uses the main shader file. Buffer and compute tabs show an editable **File** path with **Change…**: choose another file already used by the config, browse the virtual workspace, or create a source. Function rows show the available native entry points. **Add function…** writes to the file belonging to that stage and saves the selected function.

Vertex sources use **Built-in**, **Same file**, or **Separate file**. Same file hides the duplicate path; Separate file shows it and reads vertex functions from there. Native render templates start with a fragment and use the generated vertex stage. Compute has native function rows and no Built-in/Native chooser.

A native WGSL/Slang buffer's **Output** section reads attachment slots and field names from its fragment code. To connect a particular output, configure a channel, open **Misc**, select the buffer, and choose its output row. Compute sources use **Compute output layer** instead. File paths, function choices, and channel selections survive reloads with the workspace.

See [Configure Passes and Inputs](features/config-buffers.md), [Compute Passes](features/compute.md), and the [two-output WGSL example](features/multiple-render-targets.md#try-two-wgsl-outputs).

## Arrange Your Workspace

The workspace contains Shader Explorer, Editor, and Preview panels. Drag tabs to rearrange or split them, and drag the dividers to resize them. Use the top **View** menu to show or hide each panel.

The preview has its own controls for configuration, debugging, performance, and recording. Use **Workspace → Reset workspace layout** to restore the outer workspace arrangement. Use the preview's **Layout** menu to reset the viewer layout separately.

On phones, the bottom navigation shows one main destination at a time: **Explorer**, **Editor**, **Preview**, or **Tools**. Tools includes **Config**, **Debug**, **Frame Times**, and **Export** and remembers the last selection. The Preview editor overlay remains available from its Editor Overlay menu. Rotating the device or returning to a larger viewport does not replace the saved desktop Dockview layout.

## Saving and Browser Storage

Shader edits and configuration changes are saved in this browser. Reloading the app restores that workspace when storage is available. These files are not written to a folder on your computer and are not synced to VS Code, another browser, or another device. The hosted app and a local development server have separate storage.

If browser storage is unavailable, changes in that session will not survive a reload. Keep a separate copy of important shader source and configuration before clearing site data or changing browsers.

**Workspace → Clear Workspace** asks for confirmation, removes the standalone workspace and its saved layout, then reloads the app with the starter examples. This cannot be undone. Resetting the workspace layout only changes the panel arrangement.

Global preferences are kept when clearing the workspace. Use **Settings → Reset all settings** to reset them.

## Global Settings

Open **Settings** in the top toolbar to search and change browser-wide preferences. Changes apply immediately, synchronize between open tabs, and survive reloads. The panel includes **Default shader mode** (Built-in hooks or Native WGSL/Slang entry points), viewer camera defaults for GLSL/WGSL/Slang meshes, opening the editor on buffer switches, GLSL/Slang/WGSL language services, color swatches, font size, indentation, word wrap, minimap, and line numbers. Shader and pass camera settings override the global camera preference.

These preferences are stored in this browser, separately from shader files. VS Code user settings and standalone preferences are independent. Settings specific to VS Code, such as its web server port and editor group locking, stay in VS Code.

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
