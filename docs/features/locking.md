# Locking a Shader

When working with multi-buffer shaders, opening a buffer file normally switches the preview to that buffer. Click the <i class="codicon codicon-lock"></i> **Lock** button in the toolbar to keep the preview pinned to the shader you want to see.

## Why Locking Matters

Multi-buffer shaders have multiple passes — an Image pass and one or more buffer passes (like `BufferA`, `BufferB`). By default, opening a buffer file changes the preview to show that buffer's output. This is useful for debugging a specific pass, but most of the time you want to see the final Image result while you edit the buffers.

Locking solves this. Once locked, you can freely open and edit any buffer file and the preview stays on the locked shader. It also works across different shaders — you can open another shader file entirely and the preview will stay on the locked shader.

## How to Use It

1. Open the shader you want to keep visible
2. Click the <i class="codicon codicon-lock"></i> **Lock** button in the toolbar — the icon will show as locked
3. Open any buffer file to edit it — the preview stays on the locked shader
4. Click the <i class="codicon codicon-lock"></i> button again to unlock when you want the preview to follow your file selection again

## Next

[Editor Overlay](editor-overlay.md) — edit shader code inline in the preview
