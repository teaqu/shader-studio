# Shader Studio

A VS Code extension for viewing and editing GLSL fragment shaders with hot reloading, designed specifically for Shadertoy-style shaders. This project provides a complete development environment for shader programming within VS Code.

## Project Purpose

Shader Studio enables developers to write, preview, and debug GLSL shaders directly in VS Code with:
- **Live shader preview**: Real-time rendering of shaders in panels or separate windows
- **Pixel inspector**: Inspect RGB, float, hex values, fragCoord, and UV coordinates at any pixel
- **Shader explorer**: Browse and preview shader collections
- **Visual config editor**: GUI-based editor for `.sha.json` shader configuration files
- **Web server**: Serve shaders over HTTP for external viewing
- **Hot reloading**: Automatic shader updates on file changes

## Architecture

This is a **monorepo** using npm workspaces with multiple specialized packages:

### Core Workspaces

1. **`/extension/`** - The main VS Code extension
   - Extension entry point: [extension.ts](extension/src/extension.ts)
   - Core logic: [ShaderStudio.ts](extension/src/app/ShaderStudio.ts)
   - Key modules:
     - `PanelManager` - Manages webview panels for shader preview
     - `ConfigEditorProvider` - Custom editor for `.sha.json` files
     - `ShaderProvider` - Handles shader compilation and rendering
     - `WebServer` - HTTP server for external shader access
     - `GlslFileTracker` - Watches GLSL files for changes
     - `ShaderExplorerProvider` - Tree view for browsing shaders
   - Built with: TypeScript + esbuild
   - Output: `dist/extension.js`

2. **`/ui/`** - Main shader rendering UI (Svelte)
   - Webview panel interface for shader preview
   - Key components:
     - `ShaderStudio.ts` - Main shader renderer
     - `PixelInspector.svelte` - Interactive pixel inspector overlay
     - `PixelInspectorManager.ts` - Manages inspector state
     - `ShaderLocker.ts` - Shader lock/unlock functionality
   - Built with: Svelte + Vite + TypeScript
   - Tests: Vitest + Testing Library
   - Output: `dist/` → copied to `extension/ui-dist/`

3. **`/config-ui/`** - Visual config editor UI (Svelte)
   - Custom editor for `.sha.json` shader configuration files
   - Provides GUI for editing buffer passes, input channels, uniforms
   - Built with: Svelte + Vite + TypeScript
   - Output: `dist/` → copied to `extension/config-ui-dist/`

4. **`/shader-explorer/`** - Shader gallery browser UI (Svelte)
   - Tree view interface for browsing shader collections
   - Thumbnail previews and metadata display
   - Built with: Svelte + Vite + TypeScript
   - Output: `dist/` → copied to `extension/shader-explorer-dist/`

5. **`/types/`** - Shared TypeScript type definitions
   - `MessageTypes.ts` - WebSocket/message passing types
   - `ShaderConfig.ts` - Shader configuration schema types
   - Used by all workspaces for type safety

6. **`/rendering/`** - Shared rendering logic
   - WebGL shader compilation and rendering utilities
   - Used by UI components

7. **`/utils/`** - Shared utilities
   - Common helper functions used across workspaces

## Development Workflow

### Building

```bash
# Build everything (from root)
npm run build

# Build specific workspace
npm run build:extension
npm run build:ui
npm run build:config-ui
npm run build:shader-explorer

# Development mode (with hot reload)
npm run dev:ui
npm run dev:config-ui
npm run dev:shader-explorer
npm run watch:extension
```

### Testing

```bash
# Run all tests
npm test

# Test specific workspace
cd ui && npm test
cd extension && npm test
```

### Key Build Scripts

- **`build:types`** must run first - other workspaces depend on it
- UI builds are copied to `extension/{workspace}-dist/` for packaging
- Extension uses esbuild for fast bundling
- UIs use Vite for development and production builds

## File Patterns

### Shader Files

- `.glsl` - GLSL fragment shader source
- `.sha.json` - Shader configuration (buffer passes, inputs, uniforms)
  - Opens in custom visual editor by default
  - Can toggle to JSON source with toolbar button

### Configuration Schema

Shader config files define:
- Buffer passes (multi-pass rendering)
- Input channels (textures, videos, audio, webcam)
- Uniforms (custom shader parameters)
- Render settings (resolution, frame rate)

## Key Features Implementation

### Pixel Inspector

- **Location**: [ui/src/lib/components/PixelInspector.svelte](ui/src/lib/components/PixelInspector.svelte)
- **Manager**: [ui/src/lib/PixelInspectorManager.ts](ui/src/lib/PixelInspectorManager.ts)
- **Displays**:
  - RGB values (0-255)
  - Normalized float values (0.0-1.0)
  - Hex color code
  - Fragment coordinates (pixel position)
  - UV coordinates (normalized 0-1)
- **Interaction**:
  - Follows mouse cursor
  - Can be locked with click
  - Auto-flips to avoid screen edges
- **Tests**: [ui/src/test/components/PixelInspector.test.ts](ui/src/test/components/PixelInspector.test.ts)

### WebView Communication

- Extension ↔ UI communication via VS Code WebView message passing
- Message types defined in [types/src/MessageTypes.ts](types/src/MessageTypes.ts)
- Transport layer: [extension/src/app/transport/](extension/src/app/transport/)

### Hot Reloading

- `GlslFileTracker` watches `.glsl` files
- On change, sends update message to webview panels
- Shader recompiles and re-renders automatically

## Extension Commands

- `shader-studio.view` - Open shader in new panel
- `shader-studio.viewInNewWindow` - Open shader in new window
- `shader-studio.startWebServer` - Start HTTP server
- `shader-studio.stopWebServer` - Stop HTTP server
- `shader-studio.generateConfig` - Generate `.sha.json` for GLSL file
- `shader-studio.newShader` - Create new shader from template
- `shader-studio.openShaderExplorer` - Open shader gallery
- `shader-studio.transpileGlslToJs` - Debug: transpile GLSL to JavaScript

## VS Code Integration

### Custom Editors

- `.sha.json` files open in custom webview editor (priority: `default`)
- Toggle between GUI and source with toolbar buttons

### Settings

- `shader-studio.webServerPort` - HTTP server port (default: 3000)
- `shader-studio.webSocketPort` - WebSocket port (default: 51472)
- `shader-studio.defaultConfigView` - Default view for `.sha.json` (`gui` or `code`)

### Status Bar

- Shows active shader info
- Quick access to inspector controls
- Located in [extension/src/app/ShaderStudioStatusBar.ts](extension/src/app/ShaderStudioStatusBar.ts)

## Testing Strategy

### UI Components (Vitest + Testing Library)

- Component rendering and behavior tests
- Example: [PixelInspector.test.ts](ui/src/test/components/PixelInspector.test.ts)
- Focus on user interactions and display correctness
- Mock browser APIs when needed (e.g., `window.innerWidth`)

### Extension (Mocha + VS Code Test API)

- Integration tests with VS Code APIs
- Uses `@vscode/test-electron` for testing environment

## Important Notes

### Build Dependencies

1. Types must build first (all workspaces depend on it)
2. UI builds must complete before extension packaging
3. Extension build copies UI assets from workspace `dist/` folders

### Development Tips

- Use workspace-specific dev servers for UI work
- Extension requires rebuild to see changes (use watch mode)
- GLSL transpiler dependencies are manually copied to `dist/node_modules/`
- The extension activates on startup (`onStartupFinished`)

### File Paths

- Always use `PathResolver` for resolving workspace paths in extension
- UI assets are embedded in extension package
- Shader configs can reference relative paths to GLSL files

## Package Publishing

```bash
# From extension directory
npm run vsce-package  # Creates .vsix file for marketplace
```

## Common Tasks

**Add a new UI feature:**
1. Develop in `/ui/` with `npm run dev:ui`
2. Add tests in `/ui/src/test/`
3. Build and test integration with extension
4. Update types in `/types/` if needed

**Modify shader config schema:**
1. Update types in `/types/src/ShaderConfig.ts`
2. Rebuild types: `npm run build:types`
3. Update config editor in `/config-ui/`
4. Update JSON schema in `/extension/schemas/`

**Add extension command:**
1. Add command in [extension/package.json](extension/package.json) `contributes.commands`
2. Register handler in [extension.ts](extension/src/extension.ts)
3. Implement logic in appropriate module

## Git Workflow

- Main branch: `main`
- Current branch: `config-changes`
- Test changes thoroughly before merging
- Extension is published to VS Code marketplace
