# Settings


Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for `shader-studio` to find all Shader Studio settings.

You can also open settings directly from the preview toolbar: **Menu → Settings**.

## All Settings

| Setting | Type | Default | Restart Required | Description |
|---------|------|---------|-----------------|-------------|
| `shader-studio.webServerPort` | number | `3000` | No | HTTP port for the [web server](../features/web-server.md). Range: 1024–65535. |
| `shader-studio.enableSnippets` | boolean | `true` | Yes | Enable GLSL [code snippets](../features/snippet-library.md) and the snippet library. |
| `shader-studio.defaultConfigView` | string | `gui` | Yes | Default view when opening `.sha.json` files: `gui` (visual editor) or `code` (JSON source). |
| `shader-studio.navigateOnBufferSwitch` | boolean | `true` | No | When enabled, switching buffers in the config panel or editor overlay syncs the active file in the VS Code editor. Works in combination with shader lock. |
| `shader-studio.lockEditorGroup` | boolean | `true` | No | Lock the editor group when opening a shader panel, preventing other editors from opening in it. |

## Port Configuration

The web server uses a configurable HTTP port:

- **Web server port** (`webServerPort`) — serves the shader preview to browsers at `http://localhost:PORT`

## Config View Default

The `defaultConfigView` setting controls whether `.sha.json` files open in the visual GUI editor or as raw JSON source. You can always toggle between views using the toolbar button regardless of this setting.

## Editor Group Locking

When `lockEditorGroup` is enabled (the default), the VS Code editor group containing the shader preview panel will not allow other editors to open in it. This keeps your preview visible when you click on files. Disable this if you prefer standard editor group behavior.
