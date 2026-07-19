# Remove the Snippet Library Design

## Goal

Remove the standalone Snippet Library and all Shader Studio support for custom snippets while retaining the bundled GLSL snippets as native VS Code completions.

## Scope

The standalone webview feature will be deleted end-to-end:

- Remove the Snippet Library item from the Shader Studio options menu.
- Remove the `shader-studio.openSnippetLibrary` command and its runtime provider registration.
- Remove the extension provider that loads the webview, inserts snippets, and reads or writes workspace custom snippets.
- Remove the `snippet-library` workspace, its copied extension assets, and its build scripts and dependencies.
- Remove tests that exist only for the deleted provider and webview.
- Update remaining menu, extension, build, and documentation tests to describe the reduced behavior.
- Remove or rewrite documentation that presents a standalone snippet browser or custom snippet management.

The bundled files under `extension/snippets/` and their `contributes.snippets` registrations will remain. The `shader-studio.enableSnippets` setting will remain and will continue to control those native completion snippets.

## User Data

The removal must not delete, rewrite, migrate, or otherwise touch any existing `.vscode/glsl-snippets.code-snippets` file. Shader Studio will simply stop reading and writing that file. Users can continue managing their own VS Code snippets independently of Shader Studio.

## Architecture

After this change, snippet support has one path: VS Code reads the bundled snippet contribution files directly. There is no Shader Studio webview, message protocol, custom-snippet state, filesystem persistence, or menu command involved.

The obsolete `snippet-library` package and generated `extension/snippet-library-dist` artifact will be removed from the monorepo and build graph. Root and extension package scripts will build only the remaining UI packages.

## Testing

Use a removal-oriented red-green cycle:

1. Add or adjust tests so they fail while the Snippet Library menu item or command still exists.
2. Remove the UI and extension command/provider code until those tests pass.
3. Assert that bundled `contributes.snippets` entries and the `shader-studio.enableSnippets` setting remain.
4. Delete tests whose production subject is intentionally deleted rather than preserving tests for nonexistent behavior.
5. Run focused UI and extension tests, ESLint with fixes, the full UI type check, relevant package checks, and the repository build paths affected by workspace removal.

## Documentation

Documentation will describe bundled GLSL completion snippets without directing users to a Snippet Library panel. Links and feature summaries that refer to the removed panel or custom management will be removed or redirected to the remaining native-snippet documentation.

## Non-Goals

- Deleting or modifying user-authored snippet files.
- Removing the bundled GLSL snippet definitions.
- Removing the setting that enables bundled snippets.
- Adding a replacement snippet browser, editor, migration, or custom-snippet workflow.
