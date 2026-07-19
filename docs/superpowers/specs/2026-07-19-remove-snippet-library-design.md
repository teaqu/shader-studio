# Remove the Snippet Library and Add Slang Snippets Design

## Goal

Remove the standalone Snippet Library and all Shader Studio support for custom snippets while retaining the bundled GLSL snippets and adding equivalent Slang snippets as native VS Code completions.

## Scope

The standalone webview feature will be deleted end-to-end:

- Remove the Snippet Library item from the Shader Studio options menu.
- Remove the `shader-studio.openSnippetLibrary` command and its runtime provider registration.
- Remove the extension provider that loads the webview, inserts snippets, and reads or writes workspace custom snippets.
- Remove the `snippet-library` workspace, its copied extension assets, and its build scripts and dependencies.
- Remove tests that exist only for the deleted provider and webview.
- Update remaining menu, extension, build, and documentation tests to describe the reduced behavior.
- Remove or rewrite documentation that presents a standalone snippet browser or custom snippet management.

The bundled GLSL files under `extension/snippets/` and their `contributes.snippets` registrations will remain. Four corresponding Slang snippet files will be added for the same 2D SDF, 3D SDF, coordinate, and math categories. The `shader-studio.enableSnippets` setting will remain and will control both languages' native completion snippets.

## User Data

The removal must not delete, rewrite, migrate, or otherwise touch any existing `.vscode/glsl-snippets.code-snippets` file. Shader Studio will simply stop reading and writing that file. Users can continue managing their own VS Code snippets independently of Shader Studio.

## Architecture

After this change, snippet support has one path: VS Code reads the bundled snippet contribution files directly. There is no Shader Studio webview, message protocol, custom-snippet state, filesystem persistence, or menu command involved.

GLSL and Slang will use separate explicit snippet files because their vector type and constructor syntax differs. Every GLSL snippet will have a Slang entry with the same display name, prefix, description, and behavior. Slang bodies will use native syntax such as `float2`, `float3`, and `float4`. Because VS Code scopes contributions by language, the shared prefixes will not conflict: GLSL bodies appear in GLSL documents and Slang bodies appear in Slang documents.

The extension manifest and its configuration-update path will register all eight real files: four for `glsl` and four for `slang`. Turning `shader-studio.enableSnippets` off removes both sets; turning it on restores both sets.

The obsolete `snippet-library` package and generated `extension/snippet-library-dist` artifact will be removed from the monorepo and build graph. Root and extension package scripts will build only the remaining UI packages.

## Testing

Use a removal-oriented red-green cycle:

1. Add or adjust tests so they fail while the Snippet Library menu item or command still exists.
2. Remove the UI and extension command/provider code until those tests pass.
3. Add failing manifest and asset tests for the missing Slang contributions.
4. Add the four Slang files and assert exact display-name and prefix parity with the GLSL files, valid snippet body shapes, Slang-native vector syntax, and registration of all eight files.
5. Verify that the `shader-studio.enableSnippets` configuration-update path restores both language sets using only paths that exist in the extension.
6. Delete tests whose production subject is intentionally deleted rather than preserving tests for nonexistent behavior.
7. Run focused UI and extension tests, ESLint with fixes, the full UI type check, relevant package checks, and the repository build paths affected by workspace removal.

## Documentation

Documentation will describe bundled GLSL and Slang completion snippets without directing users to a Snippet Library panel. It will explain that the same prefixes work in each language and that personal snippets are managed through VS Code. Links and feature summaries that refer to the removed panel or custom management will be removed or redirected to the remaining native-snippet documentation.

## Non-Goals

- Deleting or modifying user-authored snippet files.
- Removing the bundled GLSL snippet definitions.
- Removing the setting that enables bundled snippets.
- Adding a replacement snippet browser, editor, migration, or custom-snippet workflow.
- Generating snippet files at build time or adding a snippet-generation framework.
