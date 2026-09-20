# WGSL Support

WGSL shaders (`.wgsl`) run on WebGPU in the VS Code extension and standalone
browser. A WebGPU-capable host is required. Start with [WGSL Shaders](wgsl-authoring.md)
for `mainImage`, uniforms, vertex hooks, compute entry points, and storage types.

WGSL supports single-pass and multipass rendering, Common helpers, vertex and
compute passes, storage buffers, textures, cubemaps, audio/video, and keyboard input.
Model geometry and script uniforms are also supported. See [Channels](channels.md)
for sampling.

## Editor Support and Diagnostics

Completion, hover, signature help, definitions, references, highlights, and symbol
rename are available. See [Language Servers](language-servers.md) for instructions
and the scope of rename in each editor. WGSL has no user-defined generics,
function overloads, or import/include mechanism; put shared code in Common.

As you type, the editor reports syntax errors, undefined names,
reserved words, and uses of built-ins or `discard` in an incompatible shader stage.
It reports the first syntax error; fix that error to see name and stage diagnostics.
To check expression types, function arguments, and return values,
[compile](compile-modes.md) your shader. Errors point to the relevant shader,
Common, or vertex file where possible.

When editing Common, syntax errors appear as you type. Compile a pass that uses
Common to check its helpers fully. If a helper uses an operation unavailable in
that pass, such as `dpdx` in compute code, the error identifies the helper and line.

Signature help shows named parameters and documentation for authored, Common,
channel, and built-in functions. Add leading `//` comments to document your own
functions. Signature help also works inside nested calls and template arguments.

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

Compute debugging previews one invocation at a time; it cannot reproduce threads
working together in a workgroup. `global_invocation_id` comes from the canvas
coordinate, with `z = 0` and `iDispatch = 0`. Direct `global_invocation_id`,
`local_invocation_id`, `workgroup_id`, and `local_invocation_index` parameters are
supported with literal workgroup dimensions. Other entry parameter forms report
an unsupported diagnostic.

Read-only storage access is supported. Workgroup memory, barriers, atomics,
subgroup operations, and writes to configured storage are not supported during
compute debugging. Use normal compute rendering for code that needs
cooperative workgroups or storage writes. Vertex-stage debugging is unavailable.

See [Language Support](language-support.md) to compare GLSL, Slang, and WGSL.
