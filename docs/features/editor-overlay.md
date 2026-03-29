# Editor Overlay


The editor overlay lets you edit shader code directly on top of the preview canvas. It uses a Monaco editor with GLSL syntax highlighting and a semi-transparent background so you can see the shader output while you type.

## Opening

- Click the **Editor** icon (code brackets) in the toolbar
- Or select **Editor** from the options menu
- Or run **Shader Studio: Toggle Editor Overlay** from the command palette

![Editor overlay active](../assets/placeholders/template.svg)
_Placeholder: `feature-editor-overlay.png` — Editor overlay open on top of the shader preview with Monaco editor content visible._

## Features

- **GLSL syntax highlighting** with custom shader-studio theme
- **Line numbers** with current line highlight
- **Error markers** — red squiggly underlines on lines with compilation errors, hover for full error message
- **Live recompile** — 30ms debounce on edits for near-instant preview updates
- **File sync** — 500ms debounce to save changes back to the file
- **Position preservation** — cursor position and scroll are maintained when switching buffers

## Buffer Tabs

When your shader has multiple passes (Image, BufferA, BufferB, Common, etc.), each appears as a tab along the top of the overlay. Click a tab to switch to that buffer.

- **Close (×)** on a tab removes that buffer pass from the config
- **Double-click** a tab to navigate to that file in the VS Code editor (requires shader lock to be on)
- Buffer selection syncs with the config panel

### Adding Passes from the Overlay

Click the **+** button in the tab bar to add a new pass:

| Option | Description |
|--------|-------------|
| **Buffer** | Add a new render pass (BufferA–D) |
| **Common** | Add a shared GLSL code pass (only one allowed) |
| **Script** | Add a custom uniforms script file (only one allowed) |

## Vim Mode

Toggle Vim mode from the options menu → **Vim Mode**. When active, a Vim status bar appears at the bottom of the overlay.

![Editor overlay with Vim mode](../assets/placeholders/template.svg)
_Placeholder: `feature-editor-vim.png` — Editor overlay with Vim mode status bar visible at the bottom showing the current mode (NORMAL/INSERT)._

### Vim Commands

| Command | Action |
|---------|--------|
| `:bnext` / `:bn` | Switch to next buffer |
| `:bprev` / `:bp` | Switch to previous buffer |
| `:buffer name` / `:b name` | Jump to named buffer |
| `:lnext` / `:lne` | Jump to next error |
| `:lprev` / `:lp` | Jump to previous error |

### Vim Key Mappings

| Key | Action |
|-----|--------|
| `]d` | Next diagnostic/error |
| `[d` | Previous diagnostic/error |
| `gl` | Show hover (error tooltip) |
