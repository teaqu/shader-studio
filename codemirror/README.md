# Shader Studio CodeMirror editor

The `@shader-studio/codemirror` workspace provides the reusable CodeMirror 6
editor. It does not depend on Svelte, Monaco, or the standalone shell.

- `src/editor.ts` owns the view, preferences, per-file history and selection,
  commands, Vim mode, the reconfigurable completion extension, and compiler diagnostics.
- `src/sharedDocuments.ts` owns shared text and undo/redo across panes and the preview overlay.
- `src/languages.ts` selects JavaScript/TypeScript, JSON, GLSL/Slang (C++ syntax),
  and WGSL highlighting and indentation.
- `src/theme.ts` defines light, dark, and transparent preview presentation.
- `src/languageService.ts` adapts the existing shader language-service protocol
  to completion, hover, diagnostics, and definition navigation. Hosts supply
  worker factories and authoring environments.
  Its completion source is supplied separately to `setServiceExtensions` so the
  editor can toggle automatic suggestions without recreating language services.

The Svelte host adapter is `ui/src/lib/components/CodeMirrorShaderEditor.svelte`.
It connects saving, compilation, shared selections, touch tools, and language
service settings. `ShaderEditor.svelte` chooses it or `MonacoShaderEditor.svelte`
using the host's desktop/mobile editor preferences. Mobile selection uses the
narrow viewport or primary coarse pointer; it updates when that media query changes.

Standalone Settings → Editor defaults to Monaco on desktop and CodeMirror on
mobile. Both preferences are independent and persist in browser settings. Shared
font, indentation, wrapping, and line-number preferences apply to both editors.
Automatic suggestions default to enabled and can be switched off without
disabling explicit Ctrl+Space completion. CodeMirror gutters scroll with source.
Mobile touch tools occupy one horizontal key row; More holds the other controls.
The minimap and color-picker settings currently apply to Monaco.

Run `npm test -w @shader-studio/codemirror` for package tests and
`npm run typecheck -w @shader-studio/codemirror` for source and test types.
