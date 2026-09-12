# Slang Support

Slang shaders (`.slang`) run on the WebGPU pipeline with compute passes,
storage buffers and a module system. Fragment shaders define `mainImage`,
vertex shaders define the vertex hook, and compute passes declare `[shader("compute")]`
entry points (see [Compute Passes](compute.md)).

Named channel metadata and sampling examples are in [Channels](channels.md).

## What works

- **Editing:** completion, hover, go to definition, references, highlights and
  rename are covered by named tests (`SlangLanguageService.test.ts`,
  `rename.test.ts`, `SlangRename.integration.test.ts`), including overload-aware
  rename and generic helper binding (`__generic` spelling included).
  Diagnostics report unused locals/parameters and flow through the official
  browser language server.
- **Imports:** corpus imports resolve without host errors. Symbols reached
  through `__include` (generated prelude built-ins, not authored code) are
  deliberately refused by hover and rename.
- **Rendering:** everything GLSL renders, plus compute passes
  (`SlangComputePipeline.test.ts`, corpus `compute-lab`/`particles`) and
  storage buffers (`SlangPrelude.storage.test.ts`,
  `WebGPURenderingEngine.storage.test.ts`).
- **Debugging:** inline previews and variable capture through native Slang source
  instrumentation (`SlangNativeDebug.acceptance.test.ts`,
  `SlangVariableCapture.capability.test.ts`).
- **Hosts:** VS Code extension and standalone browser.

`extension/e2e/pw/common-storage-debug.e2e.mjs` asserts changing **debug-panel**
values, including live storage reads in both fragment and compute passes:
`0.375` becomes `0.625` after a Config inspector edit. It also covers Common
source ownership and the source-arrival regression where captures were correct
but the function label stayed empty. `ShaderDebugManager.sourceContext.test.ts`
retains the unit regression. Storage-panel values are therefore asserted, not
merely read back at engine level.

The same host suite and `standalone/e2e/wgsl-storage.e2e.mjs` exercise the
subgroup replay warning and recovery after an editor change to supported code.
They also check assignment names such as `formula`: previews and capture rows
must show the value **after** the assignment, not mistake the identifier for a
`for` statement (`StatementCaptureOrder.test.ts`). Dependent-source arrival now
refreshes capture and function ownership even when Image and the cursor stay
unchanged; the standalone compute correction checks the stale-error regression.

## Limitations

- No workspace symbol search (all languages).
- No vertex-stage debugging (all languages).
- **Compute debugging is fragment replay, in both modes.**
  `SlangInstrumentationPlanner.ts` removes compute attributes, supplies synthetic
  invocation coordinates and stubs `writeOutput`. Inline preview renders that
  wrapper; `WebGPUVariableCapturer.ts` also compiles it with `passKind: "render"`
  and reads a render target. Neither dispatches a compute workgroup. The term
  “native capture” describes source instrumentation, not stage execution.
- **Cooperative compute operations are rejected during replay.** Workgroup
  memory (including workgroup atomics), barriers, subgroup operations and writes
  to configured storage produce `slang-debug-unsupported-syntax`. Native compute
  rendering retains these operations. `SlangComputeReplay.test.ts` covers both
  debug modes, storage mutations/reads, local shadowing, macro bodies and inactive
  code. `SlangComputeReplay.audit.test.ts` verifies native Slang compilation;
  `DebugReplay.e2e.test.ts` dispatches real workgroup/barrier and atomic shaders,
  asserts their numeric output, and checks the replay refusal. Fragment subgroup
  previews remain available; only compute replay is restricted.
- A faithful cooperative compute debugger needs actual compute dispatch,
  invocation selection and isolated writable resources. That is a separate
  follow-up, not implemented by the fragment replay path. Replay guards cover
  supported source analysis; they are not a proof for arbitrary imported
  side-effecting code or every macro-generated storage alias.

Back to the full matrix: [Language Support](language-support.md).
