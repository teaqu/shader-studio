# WGSL Support

WGSL shaders (`.wgsl`) run on the WebGPU pipeline with no Slang toolchain
involved. Authoring syntax — `mainImage`, channel free functions, the pointer
based `mainVertex` hook — is documented in [WGSL Shaders](wgsl-authoring.md).
This page records what is proven to work and where WGSL deliberately differs.

Named channel metadata and sampling examples are in [Channels](channels.md).

## What works

- **Editing:** completion (user symbols, intrinsics, built-ins, uniforms,
  channel resources), hover, cross-Common definition resolution, references,
  highlights and rename including Common-wide rename with collision declines
  (`WgslLanguageService.test.ts`). WGSL has no generics and no
  import/include mechanism.
- **Rendering:** the supported rendering workflows — single pass, multipass,
  Common, vertex (`mainVertex` contract), compute
  (`WebGPURenderingEngine.compute.test.ts`, corpus `compute-lab`) and storage
  buffers — plus textures, cubemaps, audio/video, keyboard, models and custom
  uniforms. The fixture corpus holds some three dozen WGSL fixtures, not two.
- **Debugging:** inline previews and variable capture using WGSL source instrumentation. Configured storage types inform inferred local
  values, including array indexing and struct fields. VS Code debug-panel tests
  capture changing Common locals and live fragment/compute storage values
  (`extension/e2e/pw/common-storage-debug.e2e.mjs`).
- **Compiler diagnostics:** Common, vertex and pass errors retain authored
  lines and columns, including leading blanks and hoisted multiline directives.
  Compiled-source cache entries retain these mappings; generated-code errors
  remain marked internal. `WgslSourceAttribution.test.ts` and
  `WebGPURenderingEngine.test.ts` cover wrapping/cache paths;
  `extension/e2e/pw/named-channels.e2e.mjs` checks actual VS Code diagnostics.
- **Malformed edits:** unmatched closing braces and malformed function
  parameters recover without looping or exhausting editor memory
  (`parserRecovery.test.ts`). Both host suites below exercise an extra closing
  brace, an error appearing, and recovery after correcting the source.
- **Capture order:** assignment identifiers such as `formula` and `returnValue`
  are not control-flow keywords. Capture runs after these assignments
  (`StatementCaptureOrder.test.ts`, `DebugReplay.e2e.test.ts`).
- **Hosts:** VS Code extension and standalone browser. WGSL needs a
  WebGPU-capable host; without one it fails with an error naming the missing
  feature.

`extension/e2e/pw/common-storage-debug.e2e.mjs` checks helper ownership, shadowing
and scalar extraction from an array of structs, with parameter controls changing
the captured value. `wgsl-debug-parity.e2e.mjs` separately checks helper parameters,
loop caps, Common and Image-linked compute captures. The common/storage suite
also verifies edited values and save/reopen for assignment captures.
`standalone/e2e/wgsl-storage.e2e.mjs` checks assignment edit/reload, separate-editor
cursor ownership and malformed-edit recovery. Separate editors route their
actual file path to the same host cursor handler used by the preview.
`ShaderDebugManager.sourceContext.test.ts` covers late Image and dependency
sources, including ownership refresh and capture invalidation without a second
cursor event.

## Limitations

- **Language-service diagnostics are hints only.** WGSL compiles in the renderer
  (WebGPU/Dawn) and the renderer compiler always wins; the language service
  does not duplicate its diagnostics.
- **Compute-stage debug capture replays a single invocation.** The planner
  rewrites the compute entry as a render entry and stubs the output write, so
  values are real for that one invocation but no workgroup is dispatched.
  `var<workgroup>` memory, barriers, atomics, subgroup operations and writes to configured storage are refused with a
  `wgsl-debug-unsupported-syntax` diagnostic; read-only storage access is
  allowed.
- Captures expose supported scalar/vector locals, including values extracted
  from arrays and structs. This does not establish whole-array/whole-struct
  capture or arbitrary pointer-value inspection.
- No workspace symbol search, no vertex-stage debugging (all languages).

Back to the full matrix: [Language Support](language-support.md).
