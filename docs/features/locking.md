# Locking a Shader

Opening a buffer, Common file, or vertex file referenced by the current shader keeps that shader's preview visible. This does not lock the preview. Opening an unrelated shader switches the preview. Click the <i class="codicon codicon-lock"></i> **Lock** button to keep the current shader visible even when you open unrelated shader files.

## Why Locking Matters

Multi-buffer shaders have an Image pass and one or more buffer passes (like `BufferA`, `BufferB`). You can edit their linked files while watching the final image without enabling Lock.

Locking is useful when editing an unrelated shader: the preview stays on the locked shader instead of following your new file selection.

## How to Use It

1. Open the shader you want to keep visible
2. Click the <i class="codicon codicon-lock"></i> **Lock** button in the toolbar — the icon will show as locked
3. Open any buffer file to edit it — the preview stays on the locked shader
4. Click the <i class="codicon codicon-lock"></i> button again to unlock when you want the preview to follow your file selection again

Hover over the Lock button to see whether the preview follows the active shader file or stays on the current shader, and what clicking the button will do.

Shader Explorer can also [keep each preview's source files open](shader-explorer.md#keep-files-with-their-preview). That setting manages editor tabs and asks before closing unsaved changes. It follows the shader actually displayed in each preview, so a locked preview retains its files.

## Double-Clicking Pass Cards

Double-click a pass card's name in the config panel to open that pass's file. Opening a pass preserves the current shader context and does not change the lock setting.

- If you have locked the shader, the preview stays on it while you edit the buffer
- If the [editor overlay](editor-overlay.md) is open, it switches to the double-clicked pass's file
- If the overlay is closed, the pass's file opens in the VS Code editor

## Preview a Buffer

Click a render pass card's **eye button** to see its output with the current shader's inputs and Common code. The **Viewing** badge marks the previewed pass; selecting a different settings card does not change the output. Click Image's eye to return to the final output. The same action is available as **Preview this pass** in the card's right-click menu.

Choose **Preview file standalone** in a buffer card's right-click menu to make its source file the active shader. This uses that file's own matching `.sha.json`, if present, rather than the parent's inputs. A buffer that requires the parent's Common code or inputs may fail to compile standalone. This explicit choice preserves the lock setting; a manual lock moves to the chosen file.

Only the current shader's known file links determine whether opening a file keeps its parent preview. Shader Studio does not search other configs to find an owner. Opening an unlinked buffer file therefore treats it as a standalone shader, even if another shader elsewhere references it.

## Next

[Editor Overlay](editor-overlay.md) — edit shader code inline in the preview
