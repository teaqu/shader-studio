# Compile Modes


Compile modes control when your shader recompiles after you make changes.

## Choosing a Mode

Open **Menu → Compile Mode** and select one of three modes:

| Mode | When it compiles |
|------|-----------------|
| <i class="codicon codicon-flame"></i> **Hot** | On every keystroke (default) |
| <i class="codicon codicon-save"></i> **Save** | Only when you save the file |
| <i class="codicon codicon-clock"></i> **Manual** | Only when you trigger it explicitly |

The current mode is shown in the menu. Your choice is saved and restored across sessions.

## Hot Mode

The shader recompiles immediately as you type. Compilation errors appear in the preview as soon as they occur.

**Best for:** Experimenting and fast iteration where you want instant visual feedback.

## Save Mode

The shader only recompiles when you save the file (`Cmd+S` / `Ctrl+S`). Unsaved edits do not trigger a recompile.

**Best for:** Working on complex changes where you don't want intermediate broken states to interrupt the preview.

## Manual Mode

The shader only compiles when you explicitly request it. Two ways to trigger:

- Press **`Ctrl+Enter`** (works from any editor)
- Click the **Compile Now** button that appears at the left of the toolbar in manual mode

**Best for:** Performance-sensitive workflows, or when you want full control over when the GPU re-executes the shader.

## Keyboard Shortcut

`Ctrl+Enter` triggers a manual compile regardless of the current mode. In hot or save modes it forces an immediate recompile.
