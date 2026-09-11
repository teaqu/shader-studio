# Language Support

Shader Studio supports three shading languages: GLSL (WebGL2), Slang (WebGPU)
and WGSL (WebGPU). This page is the evidence-backed record of what actually
works per language. Every cell is backed by a named test or an explicit stated
limitation — never by a registered capability flag. The full cell-by-cell
record with test names lives in `plans/10-audit-matrix.md`.

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
| Stale-request handling | Tested | Tested | Tested-weak |

## Parser and semantics

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Declaration/reference identity | Tested | Tested | Tested |
| Shadowing | Tested | Tested | Missing |
| Overloads | Tested | Tested | Tested |
| Struct fields | Tested | Tested | Tested |
| Generics | N/A (no generics) | Tested | N/A (no generics) |
| Imports / includes | Tested (environment `#include`s) | Tested (imports; `__include` prelude symbols refused) | N/A (no import mechanism) |
| Common and dependent passes | Tested | Tested | Tested |

## Rendering

Every rendering cell below is proven by
`rendering/src/test/e2e/ShaderFixtureCorpus.corpus.test.ts`, which asserts each
fixture draws lit pixels (an explicit `knownBlackOutput` exception list keeps
the check non-vacuous).

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Single pass / multipass / Common | Tested | Tested | Tested |
| Vertex shaders | Tested | Tested | Tested |
| Compute | N/A (WebGL2) | Tested | Tested |
| Storage buffers | N/A (WebGL2) | Tested | Tested |
| Texture / cubemap / audio / video / keyboard inputs | Tested | Tested | Tested |
| Model geometry | Tested | Tested | Tested |
| Custom uniforms from script | Tested | Tested | Tested |

## Debugging

| Feature | GLSL | Slang | WGSL |
|---|---|---|---|
| Inline rendering | Tested | Tested | Tested |
| Variable capture (fragment) | Tested | Tested | Tested |
| Vertex-stage debugging | Missing | Missing | Missing |
| Compute-stage debugging | N/A (WebGL2) | Tested | Implemented-untested |
| Common capture mapping | Implemented-untested | Tested-weak | Implemented-untested |
| Storage-backed values | N/A (WebGL2) | Tested-weak | Tested-weak |

## Hosts

| Host | GLSL | Slang | WGSL |
|---|---|---|---|
| VS Code extension | Tested | Tested | Tested |
| Standalone browser | Tested | Tested | Tested |
| Electron | Missing — no Electron host exists in this repo | | |

## Known limitations

- **Workspace symbol search** does not exist for any language.
- **WGSL diagnostics are hints only.** WGSL compiles in the renderer and its
  compiler messages win; the language service only supplements. See
  [WGSL](wgsl.md).
- **Slang `__include` prelude symbols** (generated built-ins) are refused by
  hover and rename — they are not authored code. See [Slang](slang.md).
- **Vertex-stage debugging** is not implemented for any language.
- **WGSL shadowing** and **WGSL stale-request handling** have no dedicated
  tests (cheap to add; not yet written).
- Per-language detail: [GLSL](glsl.md) · [Slang](slang.md) · [WGSL](wgsl.md).
