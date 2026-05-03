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

## Save Mode

The shader only recompiles when you save the file (`Cmd+S` / `Ctrl+S`). Unsaved edits do not trigger a recompile.

## Manual Mode

The shader only compiles when you explicitly request it. Two ways to trigger:

- Press **`Ctrl+Enter`**
- Click the <i class="codicon codicon-run-all"></i> **Compile Now** button that appears at the left of the toolbar in manual mode

## Next

[Recording](recording.md) — take screenshots and record video or GIF
