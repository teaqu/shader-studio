# Playwright VS Code E2E (prototype)

A parallel implementation of the VS Code webview E2E suite on Playwright's
Electron support, kept alongside the WebdriverIO suite rather than replacing it.

Run it with:

    npm run test:e2e:pw -w extension

## Why it exists

The WebdriverIO suite runs through `wdio-vscode-service`, which launches VS Code
from a wrapper that shells out with `child_process.execFile` and no `maxBuffer`.
Past Node's 1 MiB default it SIGTERMs VS Code mid-run with no error anywhere.
Playwright talks to Electron over CDP directly, so that whole layer disappears,
and its trace viewer records DOM snapshots per step - the missing capability
that made several failures in this area expensive to diagnose.

## Status

Proven viable, not finished.

- Electron launches, nested webview frames resolve, and **WebGPU initialises**
  (`navigator.gpu.requestAdapter()` returns an adapter) - the critical unknown.
- `host-bridge.cjs` replaces `browser.executeWorkbench`: loaded through
  `--extensionTestsPath`, it serves a loopback endpoint that evaluates a
  function against the real `vscode` module in the extension host.
- `slang-parity.e2e.mjs`: 2 of 4 tests pass. The two capture-heavy tests fail
  with "variable capture reported an error", undiagnosed.
- The other three specs are not ported, and CI still runs the WebdriverIO suite.

## Gotchas found the hard way

- A VS Code extension host exports `ELECTRON_RUN_AS_NODE` and `VSCODE_*` to its
  children. Inherited, the Electron binary boots as plain Node and never opens a
  window. `fixtures.mjs` strips them.
- The fixture must be worker-scoped. The specs build state across tests, and a
  test-scoped fixture would launch a fresh VS Code per test.
- Find the app frame by content, not by frame name: VS Code's internal webview
  frame names differ across versions (`#active-frame` vs `fake.html`).
