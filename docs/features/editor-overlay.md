# Editor Overlay

The editor overlay lets you write shader code directly on top of the preview canvas. You see the shader output behind the code as you type, so you don't have to switch back and forth between the editor and the preview.

The overlay includes editor features designed to feel similar to the VS Code editor. Due to VS Code limitations, a custom embedded editor is used instead of the native one.

![Editor overlay active](../assets/images/overlay.png)

## Opening

- Click the <i class="codicon codicon-code"></i> **Editor** icon in the toolbar
- Or run **Shader Studio: Toggle Editor Overlay** from the command palette

## Working with Multiple Passes

When your shader has multiple passes — Image, BufferA, BufferB, Common, and so on — each appears as a tab along the top of the overlay. Click a tab to switch to that pass. Changes you make are saved back to the file automatically.

**Double-click** a tab to open that file in the VS Code editor. Use [locked mode](locking.md) to keep the preview pinned while you do this.

## Vim Mode

If you prefer Vim keybindings, open the options menu while the overlay is enabled and select **Vim Mode**.

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

## Next

[Compile Modes](compile-modes.md) — choose when the shader recompiles
