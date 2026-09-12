# Language Support

Shader Studio supports three shading languages: GLSL (WebGL2), Slang (WebGPU)
and WGSL (WebGPU). This page is the evidence-backed record of what actually
works per language. Every cell is backed by a named test or an explicit stated
limitation — never by a registered capability flag. Named tests below provide the evidence; local workflow plans are not published.

Statuses: **Tested** (a named test asserts real behaviour) · **Tested-weak**
(evidence exists but has no non-vacuous guard) · **Implemented-untested** ·
**N/A** (with reason) · **Missing**.

## Editing (language service)

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Completion | Tested | Tested | Tested |
| Hover | Tested | Tested | Tested |
| Go to definition | Tested | Tested | Tested |
| References / highlights | Tested | Tested | Tested |
| Rename (same file, cross-file, Common) | Tested | Tested | Tested |
| Workspace symbol search | Missing | Missing | Missing |
| Diagnostics | Tested | Tested | Tested-weak (hints only; the renderer compiler wins) |
| Unsaved files | Tested | Tested | Tested |
| Stale-request handling | Tested | Tested | Tested |

## Parser and semantics

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Declaration/reference identity | Tested | Tested | Tested |
| Shadowing | Tested | Tested | Tested |
| Overloads | Tested | Tested | Tested |
| Struct fields | Tested | Tested | Tested |
| Generics | N/A (no generics) | Tested | N/A (no generics) |
| Imports / includes | Tested (environment `#include`s) | Tested (imports; `__include` prelude symbols refused) | N/A (no import mechanism) |
| Common and dependent passes | Tested | Tested | Tested |

## Rendering

Every rendering cell below is proven by
`rendering/src/test/e2e/ShaderFixtureCorpus.corpus.test.ts`, which asserts each
fixture draws lit pixels, apart from explicit `knownBlackOutput` exceptions.
`ui/src/test/e2e/CorpusViaTransport.e2e.test.ts` separately drives the Slang and
WGSL keyboard/storage black fixtures into lit states.

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Single pass / multipass / Common | Tested | Tested | Tested |
| Vertex shaders | Tested | Tested | Tested |
| Compute | N/A (WebGL2) | Tested | Tested |
| Storage buffers | N/A (WebGL2) | Tested | Tested |
| Texture / cubemap / audio / video / keyboard inputs | Tested | Tested | Tested |
| Named channel metadata and native sampler access | Tested | Tested | Tested (separate handles) |
| Model geometry | Tested | Tested | Tested |
| Custom uniforms from script | Tested | Tested | Tested |

Named API coverage: `NamedChannels.e2e.test.ts` checks 2D orientation, methods,
shared functions, binding aliases, mip levels and sampler overrides.
`standalone/e2e/named-channels.e2e.mjs` exercises actual editor changes, cubemap
metadata/directions, compute error recovery and reload persistence in all three
languages. `extension/e2e/pw/named-channels.e2e.mjs` separately runs in the
VS Code Extension Development Host: editor changes sample an actual green texture
using named metadata, compiler errors appear and clear, saved output survives a
window reload, and a WGSL compute pass recovers after an explicit-LOD correction.
It also checks Common, vertex-hook and hoisted Image/Common/vertex compiler
diagnostic ownership.
`WgslSourceAttribution.test.ts` and `WebGPURenderingEngine.test.ts` cover authored
ranges, linked-handle columns, generated-code errors and compiled-source cache hits.
See [Channels](channels.md) for the public API and compatibility details.

## Debugging

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Inline rendering | Tested | Tested | Tested |
| Variable capture (fragment) | Tested | Tested | Tested |
| Vertex-stage debugging | Missing | Missing | Missing |
| Compute-stage debugging | N/A (WebGL2) | Tested | Tested |
| Common capture mapping | Tested | Tested | Tested |
| Storage-backed values | N/A (WebGL2) | Tested (fragment and compute) | Tested (fragment and compute replay) |

`extension/e2e/pw/common-storage-debug.e2e.mjs` drives the actual VS Code debug
panel. In all three languages it selects a Common local, checks the function and
line ownership, excludes the root-only local, captures `0.375`, then edits it to
`0.625` and checks the updated capture. Storage tests use the Config inspector to
change the live GPU buffer from `0.375` to `0.625` and assert both captured values
and the selected function in Slang and WGSL fragment/compute panels.
These tests exposed and reproduce function context remaining empty when a cursor
event precedes source delivery (`ShaderDebugManager.sourceContext.test.ts`).
WGSL storage inference and authored capture ranges also have unit coverage in
`WgslStorageDebug.test.ts`; generated analysis bindings are excluded from emitted
shader files. These checks preserve the WGSL replay restrictions below.

## Hosts

| Host | GLSL | Slang | WGSL |
|---|---|---|---|
| VS Code extension | Tested | Tested | Tested |
| Standalone browser | Tested | Tested | Tested |
| Electron | Missing — no Electron host exists in this repo | | |

## Known limitations

- **Workspace symbol search** does not exist for any language.
- **WGSL language-service diagnostics are hints only.** WGSL compiles in the
  renderer and its compiler messages win; the language service only supplements. See
  [WGSL](wgsl.md).
- **Slang `__include` prelude symbols** (generated built-ins) are refused by
  hover and rename — they are not authored code. See [Slang](slang.md).
- **Vertex-stage debugging** is not implemented for any language.
- **WGSL compute-pass debugging replays one invocation**, it does not dispatch a
  real workgroup. Output writes are stubbed and read-only storage reads are
  permitted; `var<workgroup>` memory and configured storage *writes* are refused
  with a `wgsl-debug-unsupported-syntax` diagnostic rather than reported wrong.
  See [WGSL](wgsl.md).
- Per-language detail: [GLSL](glsl.md) · [Slang](slang.md) · [WGSL](wgsl.md).
