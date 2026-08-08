# Shader Explorer UI

A Svelte 5-based shader explorer and portfolio browser for the VS Code extension. Discovers `.glsl`, `.frag`, `.vert`, and `.slang` shader files in the workspace, renders live WebGL/WebGPU thumbnail previews, and provides search, sort, and file-management controls.

The built output (`shader-explorer-dist/`) is consumed by both the activity bar sidebar (`ShaderExplorerViewProvider`) and the full panel (`ShaderExplorerProvider`) in the extension host, which share business logic through `ShaderExplorerBackend`.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run copy-to-extension
```
