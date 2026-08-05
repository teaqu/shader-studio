# Settings


Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for `shader-studio` to find all Shader Studio settings.

You can also open settings directly from the preview toolbar: **Menu → Settings**.

## Optional WebGL GLSL Editor companion

Shader Studio can prepare diagnostics, completion, and navigation for the separately installed [WebGL GLSL Editor](https://marketplace.visualstudio.com/items?itemName=raczzalan.webgl-glsl-editor) extension (`raczzalan.webgl-glsl-editor`). The companion is optional: rendering is unaffected if it is disabled or uninstalled.

Use WebGL GLSL Editor instead of Shader Validator for Shader Studio GLSL files. Disable Shader Validator to avoid duplicate diagnostics.

For an installed companion, Shader Studio manages `webgl-glsl-editor.codeInjection` and `webgl-glsl-editor.codeInjectionSource` at workspace scope. The injected GLSL ES 300 source includes stable built-in uniforms, configured channels and aliases, and successfully inferred custom uniforms. Shader Studio leaves a user-owned injection configuration unchanged.

Within one extension host, all Shader Studio panels share the active GLSL selection. The active or focused shader context controls the injected declarations; background panels and refreshes cannot overwrite it. In a multi-root workspace, WebGL GLSL Editor has one workspace-wide injection source, so the active shader's workspace folder owns it.

Dynamic declarations come from the active shader's `.sha.json` pass inputs and configuration, plus already-evaluated custom uniforms. If a shader or config update is invalid, Shader Studio retains the last-valid shader-specific preamble. Before any valid update, it generates a stable shader-local Image fallback.

## All Settings

| Setting | Type | Default | Restart Required | Description |
|---------|------|---------|-----------------|-------------|
| `shader-studio.webServerPort` | number | `3000` | No | HTTP port for the [web server](../features/web-server.md). Range: 1024–65535. |
| `shader-studio.enableSnippets` | boolean | `true` | Yes | Enable bundled [GLSL and Slang code snippets](../features/code-snippets.md). |
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
