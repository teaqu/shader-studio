# VS Code E2E suite

The VS Code webview end-to-end tests, on Playwright's Electron support.

    npm run test:e2e:vscode:run -w extension

For per-session timing, set `SHADER_STUDIO_E2E_TIMINGS_FILE` to a writable
`.jsonl` path. Each record includes the worker key, phase and duration in
milliseconds. The phases distinguish VS Code cache lookup, optional VSIX seed
installation, profile preparation, Electron launch, workbench and bridge
readiness, extension-host readiness, test execution and teardown. Records also
carry absolute start/end times, revision, run/attempt identity and worker PID.
One-second process samples and teardown summaries report Electron descendant
RSS by role; RSS sums include shared pages, and renderer/node-service roles do
not uniquely identify a webview or extension host. The separate Chromium and
Playwright worker require whole-command tree sampling when benchmarking.
CI retains these measurements and the JSON reporter's per-case durations on
success and failure. Job timestamps distinguish dependency and scheduling
waits from execution; local test caches do not cache test execution.

After building workspace dependencies, regenerate the machine-readable test
inventory and verify the complementary CI selections with:

    node .github/scripts/e2e-inventory.mjs /tmp/e2e-inventory.json

The unit job retains this inventory on every run. Discovery errors, missing
cases, overlapping selections and duplicates fail verification.
The reviewed `expected-environments.json` also detects a removed case or a
lost GPU annotation that would silently move it to the Linux selection.
For intentional test additions/removals, append `--refresh-environments` to
the command and review the manifest diff together with the contract change.

Each window has a tracked owned process tree. Teardown first requests graceful
`app.close()` with the existing 15-second bound, then uses TERM/KILL only for
the tracked PIDs whose start identities still match. It verifies exit before
stopping the private display or deleting the profile. An unverified exit fails
teardown and retains the profile path; a cleanup error does not replace a
launch/test exception. Forced cleanup and sampling gaps remain in diagnostics.

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
- `evaluateInHost` identifies callbacks by their source hash. The bridge only
  runs callbacks compiled into `bridge-extension/host-functions.js`; requests
  cannot supply executable source. The registry includes the forms produced by
  Playwright's spec transform. After changing a host callback, run
  `node extension/e2e/pw/generate-host-functions.mjs` from the repository root.
  The bridge tests check that this generated file matches the specs.
- Most spec files set their own `vscodeKey`. Changing a worker-scoped option
  makes Playwright start a fresh worker and a fresh VS Code, so files cannot
  inherit each other's window state - without it the language-server toggles
  left by one spec broke another. A few language variants share one key inside
  a spec after explicitly closing their editors and preview between cases.
- Two workers, locally and on CI, so spec files run in parallel while tests
  inside a file stay serial. On the ci-runner Mac two workers took the `@gpu`
  selection from 245s to 133s and the rest from 168s to 95s. Parallel windows
  overlap, so the occluded-window flags below are what make this safe.
- On Linux each VS Code gets its own Xvfb display (`private-display.mjs`).
  Windows on one X display share one input focus, and a window starting up in
  one worker takes it from the other. Playwright emulates focus only for the
  workbench's main frame, so the other window's preview webview blurs: the
  config panel's `+ New` menu closes and Monaco cancels its suggest widget.
  `webview-window-focus.e2e.mjs` pins this. Set
  `SHADER_STUDIO_E2E_SHARED_DISPLAY=1` to run on the inherited display, e.g.
  to watch the windows on a desktop.
- The dedup spec keeps its 24-input journey in the VS Code webview. Its
  browser-connected journey uses the small `dedup-browser` fixture: 24 textures
  in a second Chromium starved the other worker's capture loop on the hosted
  macOS GPU, which is why CI once ran a single worker.
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

## Script uniform assertion coverage

The language matrix for the debug panel's Uniforms section lives below the
installed VS Code suite:

- `ui/src/test/components/debug/DebugPanel.uniforms.test.ts` checks exact
  built-in names and values for GLSL, Slang and WGSL, excludes script values,
  enables the inspector through its header control, and checks live updates
  and absent-uniform fallback.
- `rendering/src/test/e2e/ShaderLanguageConformance.e2e.test.ts` checks real
  scalar/vector uniform binding and rendered pixels for all three backends.
- `wgsl-script-uniform-debug.e2e.mjs` retains the assembled VS Code debug-panel
  check, with the script-driven Common/buffer/Image chain and local capture.

The installed `script-runtime-*`, context, pause, polling-rate and error-repair
tests retain the extension-host boundaries. They exercise script evaluation,
transport, reset, persistence and runtime state that a component test cannot
replace. Moving the display matrix avoids its dedicated VS Code launch; judge
the net cost with repeated same-runner comparisons that include the component
and renderer checks.

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
