# Settings


Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for `shader-studio` to find all Shader Studio settings.

You can also open settings directly from the preview toolbar: **Menu → Settings**.

## All Settings

| Setting | Type | Default | Restart Required | Description |
|---------|------|---------|-----------------|-------------|
| `shader-studio.webServerPort` | number | `3000` | No | HTTP port for the [web server](../features/web-server.md). Range: 1024–65535. |
| `shader-studio.enableSnippets` | boolean | `true` | Yes | Enable bundled [GLSL, Slang, and WGSL code snippets](../features/code-snippets.md). |
| `shader-studio.languageServers.glsl.enabled` | boolean | `true` | No | Enable [GLSL completion, hover, navigation, symbols, diagnostics, and colors](../features/language-servers.md). |
| `shader-studio.languageServers.slang.enabled` | boolean | `true` | No | Enable [Slang completion, hover, navigation, symbols, diagnostics, and colors](../features/language-servers.md). |
| `shader-studio.languageServers.wgsl.enabled` | boolean | `true` | No | Enable [WGSL completion, hover, navigation, symbols, diagnostics, and colors](../features/language-servers.md). Full validation comes from the WebGPU compiler. |
| `shader-studio.editor.colorDecorators` | boolean | `true` | No | Show [editable color swatches](../features/language-servers.md#color-picker) for literal shader color constructors. |
| `shader-studio.navigateOnBufferSwitch` | boolean | `true` | No | When enabled, switching buffers in the config panel or editor overlay syncs the active file in the VS Code editor. Works in combination with shader lock. |
| `shader-studio.lockEditorGroup` | boolean | `true` | No | Use VS Code editor-group locking to keep the preview group for the shader panel. |

## Port Configuration

The web server uses a configurable HTTP port:

- **Web server port** (`webServerPort`) — serves the shader preview to browsers at `http://localhost:PORT`

## Editor Group Locking

`shader-studio.lockEditorGroup` controls **VS Code's editor-group lock**. Once
the preview is active, its group is kept for the preview so opening files normally
uses another group. Opening a preview keeps keyboard focus in your code editor;
click the preview to activate it. Disable this setting if you want VS Code's
standard group behavior.

The preview toolbar's **shader-lock button** has a different purpose: it pins
*which shader* the preview shows while you open other files. It does not control
where VS Code opens editors. See [Locking a Shader](../features/locking.md).
