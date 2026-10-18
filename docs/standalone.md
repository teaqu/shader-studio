# Standalone Mode

[Open Shader Studio in your browser](https://teaqu.github.io/shader-studio/app/) to edit and preview shaders without installing VS Code or running the extension.

!!! warning "Alpha"
    Standalone mode is in alpha and has bugs and missing features compared with the VS Code extension. Your workspace is saved only in this browser. Clearing browser data deletes it.

## Install and Offline Use

On supported browsers, use the browser's **Install** or **Add to Home Screen** command to add Shader Studio to your device. The first online launch downloads the app and bundled GLSL examples for offline use. To make the larger Slang/WGSL compiler assets available offline, open **Workspace → Prepare Offline Compilers** and wait until the header says **Ready offline**. A first-ever offline visit cannot install the app.

Your workspace saves automatically in this browser; it is not synced between devices. **Saved** means your latest changes are stored in this browser. **Session-only** means they will not survive closing or reloading the app. Use **Workspace → Export Workspace Backup** regularly and **Import Workspace Backup…** to restore a backup. Import asks before replacing the current workspace.

A warning icon beside the save status explains storage limitations. Open **Workspace → Request storage protection** to ask the browser to keep your work when space runs low. Saving still works if protection is declined, but clearing site data always removes local work, even with protection enabled.

Shader Studio checks for updates automatically when you open or return to the app and when your connection comes back online. When an update is ready, the app saves your changes and reloads; editing pauses briefly. Close other Shader Studio tabs to allow the automatic update. Reloading while online opens the latest available version, even with other tabs open. If your connection is unavailable, Shader Studio opens its installed offline version. Automatic updates wait if saving is unavailable or fails, and do not delete your saved workspace.

If an older installation keeps returning to a previous version after a reload, close all Shader Studio tabs and reopen the app once to finish its waiting update.

## Get Started

1. Open the standalone app and select an example in **Shader Explorer**.
2. Edit the shader in the **Editor** pane and watch the **Preview** update. The default **Hot** compile mode recompiles as you type.
3. To start your own shader, click **New Shader** in Shader Explorer, enter a unique name, choose **GLSL**, **Slang**, or **WGSL**, and click **Create Shader**. WGSL/Slang start in the configured **Default shader mode**; you can choose Built-in or Native for this shader.
4. Open **Config** in the preview toolbar to add buffer passes, channels, or uniforms.

Slang and WGSL require WebGPU support in your browser and device. The examples include all three languages, shaders using the bundled texture and cubemap, and **particle-swarm.wgsl**, which drives 16384 particles from WGSL [compute passes](features/compute.md) and storage buffers. Left-drag in its preview to pull the swarm towards the pointer; right-drag to push particles away.

New browser workspaces also include **lumi-play.glsl**, a rainy-window scene with a translucent water orb, moving droplets, and an animated triangle hair clip. Select it in **Shader Explorer** to play with the effect. The artwork is available as **Lumi Play.webp** in the texture picker when configuring a channel. This image and example are bundled only with the standalone browser app.

See the [Quick Start](quick-start.md#step-3-write-your-shader) for example shader code and [Configure Buffers and Inputs](features/config-buffers.md) for pass configuration. Instructions that refer to VS Code commands or workspace files apply to the extension.

## Configure Sources and Outputs

Image always uses the main shader file. Buffer and compute tabs show an editable **File** path with **Change…**: choose another file already used by the config, browse the virtual workspace, or create a source. Function rows show the available native entry points. **Add function…** writes to the file belonging to that stage and saves the selected function.

Vertex sources use **Built-in**, **Same file**, or **Separate file**. Same file hides the duplicate path; Separate file shows it and reads vertex functions from there. Native render templates start with a fragment and use the generated vertex stage. Compute has native function rows and no Built-in/Native chooser.

A native WGSL/Slang buffer's **Output** section reads attachment slots and field names from its fragment code. To connect a particular output, configure a channel, open **Misc**, select the buffer, and choose its output row. Compute sources use **Compute output layer** instead. File paths, function choices, and channel selections survive reloads with the workspace.

See [Configure Passes and Inputs](features/config-buffers.md), [Compute Passes](features/compute.md), and the [two-output WGSL example](features/multiple-render-targets.md#try-two-wgsl-outputs).

## Arrange Your Workspace

The workspace contains Shader Explorer, Editor, and Preview panels. Drag tabs to rearrange or split them, and drag the dividers to resize them. Use the top **View** menu to show or hide each panel.

The preview has its own controls for configuration, debugging, performance, and recording. Use **Workspace → Reset workspace layout** to restore the outer workspace arrangement. Use the preview's **Layout** menu to reset the viewer layout separately.

On phones, the bottom navigation shows one main destination at a time: **Explorer**, **Editor**, **Preview**, or **Tools**. Tools includes **Config**, **Debug**, **Frame Times**, and **Export** and remembers the last selection. The Preview editor overlay remains available from its Editor Overlay menu. Rotating the device or returning to a larger viewport does not replace the saved desktop panel arrangement.

## Saving and Browser Storage

Shader edits and configuration changes are saved in this browser. Reloading the app restores that workspace when storage is available. These files are not written to a folder on your computer and are not synced to VS Code, another browser, or another device. Opening Shader Studio at a different web address gives you a separate workspace.

If browser storage is unavailable, changes in that session will not survive a reload. Keep a separate copy of important shader source and configuration before clearing site data or changing browsers.

**Workspace → Clear Workspace** asks for confirmation, removes the standalone workspace and its saved layout, then reloads the app with the starter examples. This cannot be undone. Resetting the workspace layout only changes the panel arrangement.

Global preferences are kept when clearing the workspace. Use **Settings → Reset all settings** to reset them.

## Global Settings

Open **Settings** in the top toolbar to search and change browser-wide preferences. Changes apply immediately, synchronize between open tabs, and survive reloads. The panel includes **Default shader mode** (Built-in hooks or Native WGSL/Slang entry points), viewer camera defaults for GLSL/WGSL/Slang meshes, opening the editor on buffer switches, GLSL/Slang/WGSL language services, color swatches, font size, indentation, word wrap, minimap, and line numbers. Shader and pass camera settings override the global camera preference.

These preferences are stored in this browser, separately from shader files. VS Code user settings and standalone preferences are independent. Settings specific to VS Code, such as its web server port and editor group locking, stay in VS Code.

Screenshots and recordings are saved as browser downloads.

In shader paths, `@/` means the top level of your browser workspace. For example, `@/shared/common.wgsl` refers to `common.wgsl` in its `shared` folder.

## Not yet supported

- Script passes and their custom uniforms.
- Model geometry assets.
- Slang imports/includes.
- Local workspace asset selection. The asset picker currently offers the bundled texture and cubemap.

Use the VS Code extension for these features.
