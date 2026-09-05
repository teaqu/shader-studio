# VS Code E2E suite

The VS Code webview end-to-end tests, on Playwright's Electron support.

    npm run test:e2e:vscode:run -w extension

## Why Playwright

It replaced a WebdriverIO suite that ran through `wdio-vscode-service`, which
launched VS Code from a wrapper shelling out with `child_process.execFile` and
no `maxBuffer`. Past Node's 1 MiB default that SIGTERMs VS Code mid-run with no
error anywhere - the failure this suite was rewritten to stop hitting.
Playwright talks to Electron over CDP directly, so the wrapper, chromedriver and
the buffer limit are all gone, and failures retain a trace with a DOM snapshot
per step.

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
- Two workers, so spec files run in parallel while tests inside a file stay
  serial. Measured locally: 1 worker 23.0s, 2 workers 14.7s, 4 workers 15.6s -
  with only four spec files the extra windows buy nothing. Parallel windows
  overlap, so the occluded-window flags below are what make this safe.
- Only the dedup spec needs a Playwright browser. Everything else drives VS
  Code's own Electron through `_electron.launch()`; that spec additionally
  opens the browser-connected UI, so run `npx playwright install chromium`
  before it.

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

## Slang resource deduplication

`slang-dedup.e2e.mjs` opens the real extension preview and browser-connected UI,
checks screenshot pixels and numeric variable captures, edits and saves an input
configuration, and verifies the changed result after a VS Code/window or browser
page reload. After a VS Code reload it reopens the saved shader through the
normal command; the extension does not automatically restore webview panels.
Its fixture contains 24 image inputs sharing 12 image allocations,
an extra image alias, and a compute pass with 24 keyboard inputs.

The pinned VS Code currently exposes 16 sampled textures per shader stage on the
test machine. This fixture fits that budget while exceeding 16 logical inputs.
The Chromium renderer test in `SlangChannelMetadata.e2e.test.ts` additionally
samples 24 distinct textures when the adapter supports that count.

After building the extension, run the host regression with:

    npm run test:e2e:vscode:run -w extension -- slang-dedup.e2e.mjs

The spec owns its fixture configuration and restores it after the run. Avoid
running two copies of this spec against the same checkout simultaneously.

Its second test starts the extension's web server and drives the same flow from
Chromium. Launch it with `channel: 'chromium'`, the full browser build: the
default `chromium.launch()` starts the headless shell, whose only WebGPU adapter
is SwiftShader. That adapter reports 16 sampled textures, runs at about 1 FPS
and presents a black canvas, so the spec cannot tell a rendering bug from a
missing GPU. The full build reaches the real adapter, which here offers 48
sampled textures against 16 samplers - the texture-rich, sampler-poor budget
that deduplicating samplers exists to exploit.
