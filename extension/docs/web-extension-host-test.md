# Web extension-host test (`@vscode/test-web`)

Serves the local extension (`browser: ./dist/extension-web.js`, see
[package.json](../package.json)) inside a real browser VS Code web
extension host. No dependency is added to `package.json` and
`package-lock.json` is untouched: the runner is fetched ephemerally via
`npx -y @vscode/test-web`.

## Scripts (in `extension/package.json`)

- `npm run test:web` —
  `npx -y @vscode/test-web --browserType chromium --extensionDevelopmentPath . --port 3325 .`
  Opens VS Code for the Web on this folder with the local build installed.
- `npm run test:web:headless` — same plus `--headless`, for CI.

Build the web bundle first: `node esbuild.js` (produces
`dist/extension-web.js`).

## What it proves

- `dist/extension-web.js` loads and activates in a genuine web extension
  host (not just "esbuild succeeded").
- Catches Node-only API usage in the web entry path (`Buffer`, `node:fs`,
  sync `child_process`, etc.) — the web entry
  (`src/extension-web.ts`, `src/language-services/createWebLanguageServices.ts`)
  must stay browser-safe.
- Manual pass: open a `.glsl`/`.slang` file, check language features
  (hover/diagnostics) work and no errors appear in DevTools console.

## CI (headless)

```yaml
- run: npm run build:ui && npm run build:shader-explorer && node esbuild.js
  working-directory: extension
- run: npx playwright install chromium
- run: npm run test:web:headless
  working-directory: extension
```

(`test:web:headless` serves and opens headless Chromium; without
`--extensionTestsPath` it stays open for manual inspection rather than
asserting, so CI currently proves serve + activate; add
`--extensionTestsPath <web-suite>` later for automated web tests.)
