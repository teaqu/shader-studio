# Settings


Open VS Code settings (`Cmd+,` / `Ctrl+,`) and search for `shader-studio` to find all Shader Studio settings.

You can also open settings directly from the preview toolbar: **Menu → Settings**.

## Optional WebGL GLSL Editor companion

Shader Studio can prepare diagnostics, completion, and navigation for the separately installed [WebGL GLSL Editor](https://marketplace.visualstudio.com/items?itemName=raczzalan.webgl-glsl-editor) extension (`raczzalan.webgl-glsl-editor`). The companion is optional: rendering is unaffected if it is disabled or uninstalled.

WebGL GLSL Editor and Shader Validator can both use Shader Studio's generated GLSL context. If you enable diagnostics in both companions, they can report duplicate errors; disable one companion's diagnostics if you prefer a single source.

For an installed companion, Shader Studio manages `webgl-glsl-editor.codeInjection` and `webgl-glsl-editor.codeInjectionSource` at workspace scope. The injected GLSL ES 300 source includes stable built-in uniforms, configured channels and aliases, and successfully inferred custom uniforms. When this integration is enabled, Shader Studio replaces any existing injection configuration.

Within one extension host, all Shader Studio panels and workspace folders share the active GLSL selection. The active or focused shader context controls the injected declarations; background panels and refreshes cannot overwrite it. In a multi-root workspace, WebGL GLSL Editor has one workspace-wide injection source, so the active shader's workspace folder owns it. Separate VS Code windows are independent.

Dynamic declarations come from the active shader's `.sha.json` pass inputs and configuration, plus already-evaluated custom uniforms. If a shader or config update is invalid, Shader Studio retains the last-valid shader-specific preamble. Before any valid update, it generates a stable shader-local Image fallback.

## Optional Shader Validator companion

Shader Studio can also prepare diagnostics for the separately installed [Shader Validator](https://marketplace.visualstudio.com/items?itemName=antaalt.shader-validator) extension (`antaalt.shader-validator`). It generates `.vscode/shader-studio-preamble.glsl` from the active GLSL pass, including stable built-in uniforms, configured channels and aliases, and successfully inferred custom uniforms. Rendering is unaffected if Shader Validator is disabled or uninstalled.

In a single-folder workspace, Shader Studio sets `shader-validator.glsl.preamble` as a workspace setting to `${workspaceFolder}/.vscode/shader-studio-preamble.glsl` only when you have not already configured the setting; it preserves any existing value unchanged. In a multi-root window Shader Validator has one workspace-wide preamble setting, so Shader Studio generates a preamble for every folder but does not automatically set the companion path. Choose a generated preamble file and configure its path manually, or open folders in separate VS Code windows.

## All Settings

| Setting | Type | Default | Restart Required | Description |
|---------|------|---------|-----------------|-------------|
| `shader-studio.webServerPort` | number | `3000` | No | HTTP port for the [web server](../features/web-server.md). Range: 1024–65535. |
| `shader-studio.enableSnippets` | boolean | `true` | Yes | Enable bundled [GLSL and Slang code snippets](../features/code-snippets.md). |
| `shader-studio.slangLanguageFeatures` | boolean | `true` | No | Enable Shader Studio's Slang hover, completion, navigation, symbols, signature help, and language diagnostics. Disable it when another Slang extension supplies those providers. Rendering and lexical highlighting remain enabled. |
| `shader-studio.defaultConfigView` | string | `gui` | Yes | Default view when opening `.sha.json` files: `gui` (visual editor) or `code` (JSON source). |
| `shader-studio.navigateOnBufferSwitch` | boolean | `true` | No | When enabled, switching buffers in the config panel or editor overlay syncs the active file in the VS Code editor. Works in combination with shader lock. |
| `shader-studio.lockEditorGroup` | boolean | `true` | No | Lock the editor group when opening a shader panel, preventing other editors from opening in it. |
| `shader-studio.webglGlslEditorIntegration` | boolean | `true` | No | Automatically configure WebGL GLSL Editor code injection with Shader Studio uniforms. Disabling it turns off only Shader Studio-managed injection. |

## Port Configuration

The web server uses a configurable HTTP port:

- **Web server port** (`webServerPort`) — serves the shader preview to browsers at `http://localhost:PORT`

## Config View Default

The `defaultConfigView` setting controls whether `.sha.json` files open in the visual GUI editor or as raw JSON source. You can always toggle between views using the toolbar button regardless of this setting.

## Editor Group Locking

When `lockEditorGroup` is enabled (the default), the VS Code editor group containing the shader preview panel will not allow other editors to open in it. This keeps your preview visible when you click on files. Disable this if you prefer standard editor group behavior.
