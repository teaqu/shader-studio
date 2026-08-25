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

The full suite, replacing the WebdriverIO one. 11 tests across 4 spec files,
the same coverage as before.

    npm run test:e2e:vscode:run -w extension

## Design notes

- `bridge-extension/` replaces `browser.executeWorkbench`. It is a real
  test-only extension rather than an `--extensionTestsPath` module because that
  module runs once: when VS Code restarts the extension host during startup the
  bridge would vanish for good and the suite would talk to a dead port. As an
  extension it re-activates with the host and republishes its port, which took
  the parity spec from roughly half of runs failing to 6 for 6.
- Each spec file sets its own `vscodeKey`. Changing a worker-scoped option makes
  Playwright start a fresh worker and a fresh VS Code, so files cannot inherit
  each other's window state - without it the language-server toggles left by one
  spec broke another.
- No Playwright browser download is needed. The suite drives VS Code's own
  Electron through `_electron.launch()`; verified to run with none installed.

## Gotchas found the hard way

- A VS Code extension host exports `ELECTRON_RUN_AS_NODE` and `VSCODE_*` to its
  children. Inherited, the Electron binary boots as plain Node and never opens a
  window. `fixtures.mjs` strips them.
- Find the app frame by content, not by frame name: VS Code's internal webview
  frame names differ across versions (`#active-frame` vs `fake.html`).
- VS Code cancels API calls while it is still activating, surfacing as
  "Canceled". The bridge client treats that and `ECONNREFUSED` as readiness
  signals and retries rather than failing a whole file in `beforeAll`.
- Captures re-run as a cursor change propagates, so the inspector briefly
  reports "statement was not executed". Assertions poll through that and report
  only an error that outlives the wait.

## Debugging

Failures retain a trace. Open it with:

    npx playwright show-trace extension/.playwright/<test>/trace.zip

It carries a DOM snapshot per step, which is the capability the previous runner
lacked and which several failures in this area badly needed.
