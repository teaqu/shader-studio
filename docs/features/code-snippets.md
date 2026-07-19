# GLSL and Slang Code Snippets

Shader Studio provides bundled code snippets through VS Code's native completion workflow. In a `.glsl` or `.slang` editor, type a snippet prefix and select the matching IntelliSense completion. To insert an exact prefix with `Tab`, enable VS Code's `editor.tabCompletion` setting.

The same prefixes work in either language. For example, type `sdf2d-circle`, `sdf3d-sphere`, `coord-polar`, or `math-pi`; VS Code inserts syntax for the active editor's GLSL or Slang language.

## Categories

- **2D SDF** — signed distance functions for circles, boxes, segments, and other 2D shapes
- **3D SDF** — signed distance functions for spheres, boxes, toruses, and other 3D shapes
- **Coordinate** — coordinate conversion and repetition utilities
- **Math** — the PI mathematical constant

## Custom Snippets

Shader Studio does not provide a custom snippet editor or manage user or workspace snippet files. To create or manage your own snippets, use VS Code's built-in user snippets or workspace snippets.

## Enabling Bundled Snippets

Bundled snippets are enabled by default. The `shader-studio.enableSnippets` setting controls whether Shader Studio contributes them. Reload the VS Code window after changing this setting.

## Next

[Performance](performance.md) — cap the frame rate and monitor rendering performance
