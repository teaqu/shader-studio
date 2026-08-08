# Code Snippets

Shader Studio provides bundled code snippets through VS Code's native completion workflow. Type a snippet prefix and select the matching IntelliSense completion. For example, type `sdf2d-circle`, `sdf3d-sphere`, `coord-polar`, or `math-pi` to insert the corresponding code. To insert an exact prefix with `Tab`, enable VS Code's `editor.tabCompletion` setting.

## Categories

- **2D SDF** — signed distance functions for circles, boxes, segments, and other 2D shapes
- **3D SDF** — signed distance functions for spheres, boxes, toruses, and other 3D shapes
- **Coordinate** — coordinate conversion and repetition utilities
- **Math** — the PI mathematical constant


## Enabling Bundled Snippets

Bundled snippets are enabled by default. The `shader-studio.enableSnippets` setting controls whether Shader Studio contributes them. Reload the VS Code window after changing this setting.

## Next

[Performance](performance.md) — cap the frame rate and monitor rendering performance
