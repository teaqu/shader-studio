# Settings


Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for `shader-studio` to find all Shader Studio settings.

You can also open settings directly from the preview toolbar: **Menu → Settings**.

## Optional Shader Validator companion

Shader Studio can prepare diagnostics for the separately installed [Shader Validator](https://marketplace.visualstudio.com/items?itemName=antaalt.shader-validator) extension (`antaalt.shader-validator`). The companion is optional: Shader Studio still generates its preamble file without it, and Shader Studio rendering is unaffected if Shader Validator is disabled or uninstalled.

For each workspace folder, Shader Studio installs a baseline preamble on activation, then updates `.vscode/shader-studio-preamble.glsl` from the active GLSL pass. It includes stable built-in uniforms, configured channels and aliases, and successfully inferred custom uniforms. Shader Validator's `shader-validator.glsl.preamble` setting is workspace-wide, so Shader Studio sets it to the active shader's folder only when you have not already configured the setting; existing global and workspace values remain unchanged. When unset, Shader Studio also selects Shader Validator's `OpenGL450` target and disables SPIR-V output so ordinary WebGL-style uniforms are valid.

Within one extension host, all Shader Studio panels share the active GLSL selection. The active or focused shader context controls the preamble; background panels and refreshes cannot overwrite it. In a multi-root workspace, Shader Validator supports one preamble setting, so the active shader's workspace folder owns it.

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
