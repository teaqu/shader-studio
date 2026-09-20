# WGSL Support

WGSL shaders (`.wgsl`) run on WebGPU in the VS Code extension and standalone
browser. A WebGPU-capable host is required. Start with [WGSL Shaders](wgsl-authoring.md)
for `mainImage`, uniforms, vertex hooks, compute entry points, and storage types.

WGSL supports single-pass and multipass rendering, Common helpers, vertex and
compute passes, storage buffers, textures, cubemaps, audio/video, and keyboard input.
Model geometry and script uniforms are available in the VS Code extension, not
standalone. See [Channels](channels.md) for sampling.

## Editor Support and Diagnostics

Completion, hover, signature help, definitions, references, highlights, and symbol
rename are available. See [Language Servers](language-servers.md) for instructions
and the scope of rename in each editor. WGSL has no user-defined generics,
function overloads, or import/include mechanism; put shared code in Common.

Before compilation, the language service reports syntax errors, undefined names,
reserved words, and uses of built-ins or `discard` in an incompatible shader stage.
It reports the first syntax error; fix that error to see name and stage diagnostics.
These checks do not type-check expressions, function arguments, or return values.
Full validation comes from the renderer's WebGPU compiler. Compiler errors point
to the authored shader, Common, or vertex source where possible and refresh when
you [compile](compile-modes.md) again.

When editing Common itself, the language service reports syntax errors only.
Stage checks run in the context of a pass: if a compute entry calls a Common
helper that uses `dpdx`, the diagnostic appears at the pass's call and identifies
the Common helper and line. Helpers that no entry calls do not receive stage
diagnostics. Compiler diagnostics can still point into Common when a pass compiles.

Signature help shows named parameters and documentation for authored, Common,
channel, and built-in functions. Add leading `//` comments to document your own
functions. It follows nested calls and template arguments and suggests a signature
based on the number of arguments; it does not check argument types.

Vector component completion suggests components and prefixes such as `x`, `xy`,
and `xyz`. Other valid selections, such as `yx`, can be typed manually.

## Debugging and Capture Types

Enable debug mode, place the cursor on a value, and use [inline rendering](../debugging/inline-rendering.md)
or the [Variable Inspector](../debugging/variable-inspector.md). Common helpers,
function parameter overrides, and loop iteration caps are supported.

Scalar and vector locals, parameters, and return values can be captured, including
values read from arrays, struct fields, and configured storage. Types are inferred
for many unannotated `let` and `var` declarations, including expressions using
`iTime`, `sin`, `select`, and pointer dereferences. If a local initialized from a
channel sample or another function is missing from capture, add an explicit type.
Whole arrays, whole structs, and arbitrary pointer values cannot be displayed as
capture rows; select an element or field instead.

Both `mat2x2f` and `mat2x2<f32>` can be captured, including inferred locals,
return values, and storage elements. The four values appear in column-major order:

```wgsl
let basis = mat2x2f(0.125, 0.25, 0.5, 0.75);
// Capture: 0.125, 0.25, 0.5, 0.75
//          column 0     column 1
```

Larger matrices and `f16` matrices are not capturable as a whole. Select a supported
column or scalar component instead. Matrix capture in the Variable Inspector is
separate from the Storage inspector, which edits scalar and vector buffer elements.

## Compute Debugging Limits

Compute debugging replays a selected invocation as a fragment on the canvas; it
does not dispatch a workgroup. `global_invocation_id` comes from the canvas
coordinate, with `z = 0` and `iDispatch = 0`. Direct `global_invocation_id`,
`local_invocation_id`, `workgroup_id`, and `local_invocation_index` parameters are
supported with literal workgroup dimensions. Other entry parameter forms report
an unsupported diagnostic.

Read-only storage access is supported. Workgroup memory, barriers, atomics,
subgroup operations, and writes to configured storage report
`wgsl-debug-unsupported-syntax`. Use normal compute rendering for code that needs
cooperative workgroups or storage writes. Vertex-stage debugging is unavailable.

See [Language Support](language-support.md) to compare GLSL, Slang, and WGSL.
