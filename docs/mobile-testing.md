# Shader Studio on Phones and Tablets

[Open Shader Studio in your browser](https://teaqu.github.io/shader-studio/app/) to edit and preview shaders on a phone or tablet. You do not need VS Code or a computer running Shader Studio.

Standalone mode is in alpha. Save regular [workspace backups](standalone.md#saving-and-browser-storage), especially before clearing browser data or moving to another device.

## Open and Edit a Shader

1. In **Studio**, select an example or choose **New Shader**. **Studio** has two sections at the bottom: **Shaders** lists your shaders and **Files** lists every file in the workspace. Start with **GLSL** if your device does not support WebGPU.
2. Selecting a shader switches to **Editor**, where you can change it. Each open file has a tab at the top of **Editor**; tap a tab to switch files. To return to **Editor** later, tap it in the bottom navigation. In the default **Hot** compile mode, the preview updates as you type.
3. Tap **Preview** to see the result with more screen space.
4. Tap **Tools** to open **Config**, **Debug**, **Frame Times**, or **Export**. Tools remembers your last selection.

On a phone or tablet, a bar under the code holds **Undo** (↶), **Redo** (↷), **Select**, **All**, **Copy**, **Cut**, **Paste**, and **Menu**. **Undo** and **Redo** step back and forward through your edits, and are dimmed when there is nothing to undo or redo. Phone browsers cannot show their own selection handles in the code editor, so use the bar instead:

1. Tap **Select**, then drag your finger over the code you want. While **Select** is on, dragging selects text instead of scrolling. Tap **Select** again to turn it off.
2. Tap **Copy** or **Cut**. **Select** turns off afterward, so dragging scrolls again.
3. Tap where you want the text to go, then tap **Paste**. To replace the whole file, tap **All** first.

Your browser may show its own **Paste** button before it lets Shader Studio read the clipboard; tap it to finish pasting. Tap **Menu** to open the editor menu at the cursor, with **Cut**, **Copy**, **Paste**, and the editor's code actions. Touching and holding the code without moving your finger also opens it.

When a line is wider than the screen, a scrollbar appears along the bottom of the editor. Swipe sideways or drag the scrollbar to see the rest of the line.

Rotate your device when you need more room. You can also enable **Editor Overlay** from the preview menu to edit with the shader visible behind your code. Returning to a desktop-sized window restores your desktop panel arrangement.

## Add to Your Home Screen

Use your browser's **Install** or **Add to Home Screen** action when available. The exact menu depends on your device and browser. Open the app online first so it can download what it needs.

For Slang or WGSL offline use, choose **Workspace → Prepare Offline Compilers** and wait for **Ready offline** before disconnecting. These languages also require WebGPU support on your device. Installing the app does not add graphics features that your browser or device lacks.

## Keep Your Work

Your workspace is saved in the current browser and is not synced between devices. On a phone, the **Workspace** menu (⋮), **Settings** (gear icon), and the save status sit beside the **Shaders** and **Files** tabs in **Studio**. Check the save status before closing the app:

- **Saved** means your latest changes are stored in this browser.
- **Session-only** means they will be lost when you close or reload the app. Export a backup before leaving.
- A warning beside the save status explains any storage limitation. Open **Workspace** for backup and storage-protection actions.

Use **Workspace → Export Workspace Backup** to download a copy. On another device, open Shader Studio and choose **Import Workspace Backup…**. Import asks before replacing that device's current workspace.

## If the Preview Is Slow or Unavailable

- Lower the [resolution](features/resolution.md) or cap the [frame rate](features/performance.md) to reduce graphics load.
- Close the debug tools when you do not need them.
- If Slang or WGSL reports that WebGPU is unavailable, try a GLSL example or use a device and browser with WebGPU support.
- Available recording formats depend on your browser. Use the choices offered in [Export](features/recording.md).

See [Standalone Mode](standalone.md) for settings, updates, backups, and feature limits.
