# Remove the Snippet Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the standalone Snippet Library and custom-snippet integration while retaining Shader Studio's bundled native VS Code snippets.

**Architecture:** Delete the webview package and extension provider so VS Code's `contributes.snippets` mechanism is the only remaining snippet path. Remove all entry points and build-graph references, preserve the built-in snippet setting and files, and never access or mutate user-owned `.vscode/glsl-snippets.code-snippets` files.

**Tech Stack:** Svelte 5, TypeScript, Vitest, VS Code extension API, npm workspaces, Turborepo, MkDocs

---

## File Map

- `ui/src/lib/components/MenuBar.svelte`: remove the standalone library menu action.
- `ui/src/test/MenuBar.test.ts`: specify that no library action is rendered while other non-shader actions remain.
- `extension/src/app/ShaderStudio.ts`: stop constructing and disposing the library provider.
- `extension/src/app/SnippetLibraryProvider.ts`: delete the webview, insertion, state, and custom-file implementation.
- `extension/src/test/app/SnippetLibraryProvider.test.ts`: delete tests for the removed provider.
- `extension/src/app/TabGroupResolver.ts` and its test: remove the obsolete label fallback while retaining the generic `shader-studio` view-type detection.
- `extension/package.json`: remove the command and webview build script, but preserve the snippet configuration and contributions.
- `extension/src/test/snippet-manifest.test.ts`: protect the remaining native snippet contract and absence of the removed command.
- `package.json`, `package-lock.json`, and `vitest.config.ts`: remove the deleted workspace and scripts from the monorepo graph.
- `extension/src/test/snippet-build-metadata.test.ts`: protect the root and extension build graph from reintroducing the webview package.
- `snippet-library/`: delete the complete standalone Svelte application and its tests.
- `extension/snippet-library-dist/`: remove the generated local webview artifact.
- `docs/features/code-snippets.md`: document the remaining native completion snippets.
- `docs/features/snippet-library.md` and `docs/assets/images/snippet-library.png`: delete panel-specific documentation and imagery.
- `README.md`, `extension/README.md`, `docs/index.md`, `docs/quick-start.md`, `docs/features/shader-explorer.md`, `docs/help/settings.md`, and `mkdocs.yml`: remove or redirect current-feature references.
- `docs/release-notes.md` and `extension/CHANGELOG.md`: retain historical release statements; they describe what old releases contained.

### Task 1: Remove the Shader Studio menu entry

**Files:**
- Modify: `ui/src/test/MenuBar.test.ts`
- Modify: `ui/src/lib/components/MenuBar.svelte`

- [ ] **Step 1: Write the failing menu test**

Replace the test that keeps all three non-shader actions enabled with this contract:

```ts
it('should keep New Shader and Shader Explorer enabled without showing Snippet Library', async () => {
  renderMenuBar({ props: { ...defaultProps, hasShader: false } });

  await fireEvent.click(screen.getByLabelText('Open options menu'));

  expect(screen.getByLabelText('New shader')).not.toBeDisabled();
  expect(screen.getByLabelText('Shader explorer')).not.toBeDisabled();
  expect(screen.queryByLabelText('Snippet library')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd ui && npx vitest run src/test/MenuBar.test.ts -t "without showing Snippet Library"
```

Expected: FAIL because the current options menu still contains the `Snippet library` button.

- [ ] **Step 3: Remove the menu action and obsolete command test**

Delete this complete button block from `MenuBar.svelte`:

```svelte
<button
  class="options-menu-item"
  onclick={() => {
    onExtensionCommand('openSnippetLibrary'); showOptionsMenu = false;
  }}
  aria-label="Snippet library"
>
  <i class="codicon codicon-library"></i>
  <span>Snippet Library</span>
</button>
```

Delete the `should call onExtensionCommand with openSnippetLibrary` test from `MenuBar.test.ts`.

- [ ] **Step 4: Run the full MenuBar test file and verify GREEN**

Run:

```bash
cd ui && npx vitest run src/test/MenuBar.test.ts
```

Expected: PASS with no Snippet Library menu expectations remaining.

- [ ] **Step 5: Commit the menu slice**

```bash
git add ui/src/lib/components/MenuBar.svelte ui/src/test/MenuBar.test.ts
git commit -m "refactor(ui): remove snippet library menu"
```

### Task 2: Remove the extension command, provider, and custom-snippet runtime

**Files:**
- Create: `extension/src/test/snippet-manifest.test.ts`
- Modify: `extension/package.json`
- Modify: `extension/src/app/ShaderStudio.ts`
- Modify: `extension/src/app/TabGroupResolver.ts`
- Modify: `extension/src/test/app/TabGroupResolver.test.ts`
- Delete: `extension/src/app/SnippetLibraryProvider.ts`
- Delete: `extension/src/test/app/SnippetLibraryProvider.test.ts`

- [ ] **Step 1: Write failing extension-manifest tests**

Create `extension/src/test/snippet-manifest.test.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface ExtensionManifest {
  contributes: {
    commands: Array<{ command: string }>;
    configuration: {
      properties: Record<string, unknown>;
    };
    snippets: Array<{ language: string; path: string }>;
  };
}

function readManifest(): ExtensionManifest {
  const manifestPath = path.resolve(__dirname, '../../package.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ExtensionManifest;
}

suite('Snippet manifest', () => {
  test('does not contribute the removed Snippet Library command', () => {
    const manifest = readManifest();
    assert.strictEqual(
      manifest.contributes.commands.some(
        ({ command }) => command === 'shader-studio.openSnippetLibrary',
      ),
      false,
    );
  });

  test('retains bundled GLSL snippets and their enable setting', () => {
    const manifest = readManifest();
    assert.ok('shader-studio.enableSnippets' in manifest.contributes.configuration.properties);
    assert.deepStrictEqual(manifest.contributes.snippets, [
      { language: 'glsl', path: './snippets/sdf-2d.code-snippets' },
      { language: 'glsl', path: './snippets/sdf-3d.code-snippets' },
      { language: 'glsl', path: './snippets/math.code-snippets' },
      { language: 'glsl', path: './snippets/coordinates.code-snippets' },
    ]);
  });
});
```

- [ ] **Step 2: Compile and run the new test to verify RED**

Run:

```bash
cd extension && npm run compile-tests && npx vscode-test --grep "Snippet manifest"
```

Expected: FAIL because `shader-studio.openSnippetLibrary` is still contributed. The bundled-snippet assertion should pass.

- [ ] **Step 3: Remove extension registration and command contribution**

In `ShaderStudio.ts`, delete:

```ts
import { SnippetLibraryProvider } from "./SnippetLibraryProvider";
```

Delete the `snippetLibraryProvider` property, the constructor registration block, and this disposal call:

```ts
this.snippetLibraryProvider.dispose();
```

In `extension/package.json`, delete only the command object whose command is `shader-studio.openSnippetLibrary`. Do not modify `shader-studio.enableSnippets` or `contributes.snippets`.

- [ ] **Step 4: Delete the provider implementation and its tests**

Delete `extension/src/app/SnippetLibraryProvider.ts` and `extension/src/test/app/SnippetLibraryProvider.test.ts`. This removes all code that reads or writes `.vscode/glsl-snippets.code-snippets`; do not add deletion or migration code for that user-owned file.

- [ ] **Step 5: Remove the obsolete label-specific tab fallback**

Change the fallback in `TabGroupResolver.ts` to:

```ts
const extensionLabels = ["Shader Studio", "Shader Explorer"];
```

Delete these obsolete tests from `TabGroupResolver.test.ts`:

- `detects tab by shader-studio.snippetLibrary viewType`
- `detects tab by "Snippet Library" label`
- `excludes group with Snippet Library`

The generic `viewType.startsWith(EXTENSION_PREFIX)` coverage remains unchanged.

- [ ] **Step 6: Compile and run extension tests to verify GREEN**

Run:

```bash
cd extension && npm run compile-tests && npx vscode-test --grep "Snippet manifest|TabGroupResolver|ShaderStudio"
```

Expected: PASS; the manifest has no library command, bundled snippets remain, and the extension host compiles without the provider.

- [ ] **Step 7: Commit the extension slice**

```bash
git add extension/package.json extension/src/app/ShaderStudio.ts extension/src/app/TabGroupResolver.ts extension/src/test/app/TabGroupResolver.test.ts extension/src/test/snippet-manifest.test.ts
git add -u extension/src/app/SnippetLibraryProvider.ts extension/src/test/app/SnippetLibraryProvider.test.ts
git commit -m "refactor(extension): remove snippet library provider"
```

### Task 3: Remove the webview package from the build graph

**Files:**
- Create: `extension/src/test/snippet-build-metadata.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.ts`
- Modify: `extension/package.json`
- Delete: `snippet-library/`
- Delete: `extension/snippet-library-dist/` local generated output

- [ ] **Step 1: Write the failing build-metadata test**

Create `extension/src/test/snippet-build-metadata.test.ts`:

```ts
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface PackageManifest {
  workspaces?: string[];
  scripts: Record<string, string>;
}

function readJson(filePath: string): PackageManifest {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageManifest;
}

suite('Snippet build metadata', () => {
  test('does not include the removed webview package or build scripts', () => {
    const root = readJson(path.resolve(__dirname, '../../../package.json'));
    const extension = readJson(path.resolve(__dirname, '../../package.json'));

    assert.ok(!root.workspaces?.includes('snippet-library'));
    assert.ok(!('build:snippet-library' in root.scripts));
    assert.ok(!('dev:snippet-library' in root.scripts));
    assert.ok(!root.scripts.compile.includes('snippet-library-ui'));
    assert.ok(!('build:snippet-library' in extension.scripts));
    assert.ok(!extension.scripts.package.includes('build:snippet-library'));
  });
});
```

- [ ] **Step 2: Compile and run the new test to verify RED**

Run:

```bash
cd extension && npm run compile-tests && npx vscode-test --grep "Snippet build metadata"
```

Expected: FAIL on the current `snippet-library` workspace and build scripts.

- [ ] **Step 3: Remove root build-graph references**

In root `package.json`:

- Remove `snippet-library` from `workspaces`.
- Remove `--filter=snippet-library-ui` from `compile`.
- Delete `build:snippet-library` and `dev:snippet-library`.

In `vitest.config.ts`, delete:

```ts
'snippet-library/vitest.config.ts',
```

- [ ] **Step 4: Remove extension packaging references**

In `extension/package.json`:

- Remove `npm run build:snippet-library &&` from `scripts.package`.
- Delete the `build:snippet-library` script.

- [ ] **Step 5: Delete the standalone package and generated artifact**

Delete every tracked file under `snippet-library/`. Remove the ignored generated directory `extension/snippet-library-dist/` with the repository's installed `rimraf` executable. Do not inspect, delete, or modify any workspace `.vscode/glsl-snippets.code-snippets` file.

- [ ] **Step 6: Regenerate the npm lockfile mechanically**

Run:

```bash
npm install --package-lock-only --ignore-scripts
```

Expected: exit 0 and no `node_modules/snippet-library` workspace entry in `package-lock.json`.

- [ ] **Step 7: Verify the build-metadata test is GREEN**

Run:

```bash
cd extension && npm run compile-tests && npx vscode-test --grep "Snippet build metadata"
```

Expected: PASS.

- [ ] **Step 8: Commit the build-graph slice**

```bash
git add package.json package-lock.json vitest.config.ts extension/package.json extension/src/test/snippet-build-metadata.test.ts
git add -u snippet-library
git commit -m "build: remove snippet library workspace"
```

### Task 4: Replace current Snippet Library documentation with native snippet documentation

**Files:**
- Create: `docs/features/code-snippets.md`
- Delete: `docs/features/snippet-library.md`
- Delete: `docs/assets/images/snippet-library.png`
- Modify: `README.md`
- Modify: `extension/README.md`
- Modify: `docs/index.md`
- Modify: `docs/quick-start.md`
- Modify: `docs/features/shader-explorer.md`
- Modify: `docs/help/settings.md`
- Modify: `mkdocs.yml`

- [ ] **Step 1: Verify the stale current-feature references exist**

Run:

```bash
rg -n "Snippet Library|snippet-library|build:snippet-library" README.md extension/README.md docs/index.md docs/quick-start.md docs/features docs/help/settings.md mkdocs.yml
```

Expected: matches for the removed panel, command, custom CRUD, build target, and documentation route.

- [ ] **Step 2: Create focused native-snippet documentation**

Create `docs/features/code-snippets.md` with this content:

```md
# GLSL Code Snippets

Shader Studio contributes built-in GLSL snippets through VS Code's native completion system. In a GLSL editor, type a snippet prefix and select the matching completion or press `Tab` to insert it.

The bundled categories are 2D signed-distance functions, 3D signed-distance functions, coordinate helpers, and math constants. The source definitions live in the extension's `snippets` directory.

Shader Studio does not provide a custom snippet editor or manage workspace snippet files. To create personal snippets, use VS Code's standard user or workspace snippet support.

Snippets are enabled by default. Set `shader-studio.enableSnippets` and reload the VS Code window to change whether Shader Studio contributes its bundled snippets.
```

- [ ] **Step 3: Remove panel-specific documentation and update current links**

Delete `docs/features/snippet-library.md` and `docs/assets/images/snippet-library.png`.

Make these exact content changes:

- Root `README.md`: remove `npm run build:snippet-library` from targeted build commands.
- `extension/README.md`: rename the feature row to `GLSL Code Snippets`, link to `/features/code-snippets/`, and describe native completion insertion.
- `docs/index.md`: split `Shader Explorer & Snippet Library` into a Shader Explorer section plus a short `GLSL Code Snippets` section linking to `features/code-snippets.md`.
- `docs/quick-start.md`: remove `snippet library` from the menu examples.
- `docs/features/shader-explorer.md`: change the next link from Snippet Library to GLSL Code Snippets.
- `docs/help/settings.md`: point `shader-studio.enableSnippets` to `../features/code-snippets.md` and describe only bundled GLSL code snippets.
- `mkdocs.yml`: replace `Snippet Library: features/snippet-library.md` with `GLSL Code Snippets: features/code-snippets.md`.

Do not rewrite the historical entries in `docs/release-notes.md` or `extension/CHANGELOG.md`.

- [ ] **Step 4: Verify current documentation has no stale library references**

Run:

```bash
rg -n "Snippet Library|snippet-library|build:snippet-library" README.md extension/README.md docs/index.md docs/quick-start.md docs/features docs/help/settings.md mkdocs.yml
```

Expected: no matches.

- [ ] **Step 5: Build the docs**

Run:

```bash
mkdocs build --strict
```

Expected: exit 0 with no missing links or navigation warnings.

- [ ] **Step 6: Commit the documentation slice**

```bash
git add README.md extension/README.md docs/features/code-snippets.md docs/index.md docs/quick-start.md docs/features/shader-explorer.md docs/help/settings.md mkdocs.yml
git add -u docs/features/snippet-library.md docs/assets/images/snippet-library.png
git commit -m "docs: replace snippet library with native snippets"
```

### Task 5: Full verification and scope audit

**Files:**
- Modify mechanically if needed: linted files in the preceding tasks

- [ ] **Step 1: Run ESLint with fixes as required by `AGENTS.md`**

Run:

```bash
npx eslint --fix .
```

Expected: exit 0. Review any formatter changes and keep them limited to files in this plan.

- [ ] **Step 2: Run the full UI test suite**

Run:

```bash
cd ui && npx vitest run
```

Expected: all UI tests pass.

- [ ] **Step 3: Run the full UI type check**

Run:

```bash
cd ui && npm run check
```

Expected: exit 0 with no Svelte or TypeScript errors or warnings.

- [ ] **Step 4: Run the full extension test suite**

Run:

```bash
cd extension && npm test
```

Expected: extension compilation, lint, and all VS Code tests pass.

- [ ] **Step 5: Verify the affected monorepo build graph**

Run:

```bash
npm run compile
```

Expected: exit 0 while building only the remaining UI workspaces and extension code; no Snippet Library build or copy step appears.

- [ ] **Step 6: Audit remaining references and protected functionality**

Run:

```bash
rg -n -i "snippet-library|SnippetLibraryProvider|openSnippetLibrary|saveCustomSnippet|updateCustomSnippet|deleteCustomSnippet" . --glob '!**/node_modules/**' --glob '!**/.git/**' --glob '!docs/release-notes.md' --glob '!extension/CHANGELOG.md' --glob '!docs/superpowers/**'
```

Expected: no matches.

Run:

```bash
test -d extension/snippets && rg -n '"snippets"|shader-studio.enableSnippets' extension/package.json
```

Expected: the snippet directory exists, and both the built-in contribution and setting remain in the manifest.

- [ ] **Step 7: Confirm user files and unrelated work were not touched**

Run:

```bash
git status --short
git diff --name-only HEAD~4..HEAD
```

Expected: implementation commits contain only the files listed in this plan. Pre-existing rendering changes remain uncommitted and unchanged. No `.vscode/glsl-snippets.code-snippets` path appears.

- [ ] **Step 8: Commit any lint-only adjustments after verification**

If ESLint changed an in-scope file after its slice commit:

```bash
git add ui/src/lib/components/MenuBar.svelte ui/src/test/MenuBar.test.ts extension/src/app/ShaderStudio.ts extension/src/app/TabGroupResolver.ts extension/src/test/app/TabGroupResolver.test.ts extension/src/test/snippet-manifest.test.ts extension/src/test/snippet-build-metadata.test.ts
git commit -m "style: apply snippet removal lint fixes"
```

If ESLint made no changes, skip this commit.
