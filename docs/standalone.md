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

See the [Quick Start](quick-start.md#step-3-write-your-shader) for example shader code and [Configure Buffers and Inputs](features/config-buffers.md) for pass configuration. Instructions that refer to VS Code commands or workspace files apply to the extension.

## Configure Sources and Outputs

### Upload Files

In the **Files** pane, use **Upload Files** or drag and drop shader sources, matching `.sha.json` configuration files, or assets from your device. You can select several files at once. Files are added to the workspace root by default, or to the selected folder; your other work stays in place. Uploaded shaders appear in **Shader Explorer**. Upload each shader and its config together to keep their settings.

For an image, cubemap, volume, audio, or video input, open its channel in **Config** and select the matching tab. Click **Upload…** to choose a file from your device. It is saved beside the shader and selected for that channel automatically. You can also choose an asset already in the browser workspace. Cubemaps use a single T-cross image with six square faces, arranged four faces wide and three faces high.

Files uploaded together share a directory, so a config can refer to an asset by filename, such as `photo.png`. For buffer and vertex sources, use **Change…** to choose an uploaded source.

An upload never replaces an existing file. If a filename is already present, rename the file on your device and select the files again. Uploads save in this browser and are included in workspace backups. Browser storage limits still apply; if saving fails, keep the original files and export a backup before closing the app. Files are stored locally in the browser and are not sent to a server.

### File Explorer

**Files** is a separate dockable pane alongside **Shader Explorer**, available only in standalone. Use **View → Files** to show or hide it. Drag its header to move the pane; the layout is remembered after reload. No `/shaders` wrapper is required.

Starter files and newly created shaders live at the workspace root. Existing standalone workspaces move files out of the old `/shaders` wrapper once and update their references. If a destination conflicts with an existing root file, the old folder is kept intact so nothing is overwritten.

- Click a folder to expand or collapse it. Use the filter field to find a filename or path.
- Ctrl/Cmd-click to toggle files in a selection, Shift-click to select a range, or use **Select** to select several files with ordinary clicks. Ctrl/Cmd+A selects all visible rows. Every selected row stays highlighted.
- Click shader source to open it in the editor and preview. Other text files, including `.sha.json` configs, open in editor tabs. Click an image, audio, or video asset to preview it; cubemap images show their face layout.
- Use **New file** to enter a path, such as `/shared/common.glsl`. Use **New folder** to create an empty folder.
- Drop device files onto a folder or select it and use **Upload Files** to add files there. Drop onto empty space to add files at the root. Drag files or folders within the tree to move them. When a file is selected, uploads go into its parent folder.
- Select files or folders, then use **Delete** or **Download** below the tree, or right-click for the same actions. Downloads of multiple files or a folder produce one ZIP with the folder structure and asset bytes preserved; a single file downloads directly. Drag a selection onto a folder to move all selected items. **F2** opens Rename for a single selection and **Delete** asks before removing the selection.

Rename accepts a full destination path, so it can also move files and folders. Renaming or deleting a shader includes its matching `.sha.json` config. Renaming does not rewrite references in other files: update any paths that refer to the renamed or moved item. Deleting a folder removes everything inside it after confirmation and cannot be undone; export a workspace backup first if you need a recovery copy.

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

Use the VS Code extension for these features.
