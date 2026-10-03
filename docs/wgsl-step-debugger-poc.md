# WGSL step debugger proof of concept

The experimental **Shader Studio WGSL Trace (PoC)** debugger records execution on WebGPU, then uses VS Code's debug toolbar to navigate that recording. The existing Shader Studio preview and variable inspector use their original code and state.

Launch a single-file `.wgsl` fragment shader from Run and Debug with:

```json
{
  "type": "shader-studio-wgsl-trace",
  "request": "launch",
  "name": "Trace WGSL pixel (PoC)",
  "program": "${file}",
  "width": 256,
  "height": 256,
  "pixel": [128, 128],
  "time": 0,
  "frame": 0,
  "capacity": 4096
}
```

To trace the preview, enable the pixel inspector, select a pixel, and click **Start Trace** in its section. The button snapshots the selected pixel, render resolution, time/frame, mouse/date/camera inputs and current custom uniform values. It is available through VS Code and its connected preview host for a single fullscreen WGSL Image without channels, buffers, Common code or storage. Unsupported configurations show a disabled button with the reason. If the editor source differs from the preview snapshot, refresh the preview before tracing.

`pixel` uses a top-left origin. The shader receives ordinary bottom-left `mainImage` coordinates. The runner renders at the specified resolution, preserving neighbouring fragment execution and derivatives; only the selected pixel records events. Manual launch inputs remain explicit; optional `uniforms` supplies `timeDelta`, `frameRate`, `mouse`, `date`, `cameraPos`, `cameraDir` and `sampleRate`. Without those inputs, mouse/date/camera values are zero and sample rate is 44100. The Start Trace button supplies the current preview inputs.

For example:

```wgsl
fn mainImage(p: vec2f) -> vec4f {
  var value: f32 = 0.125;
  for (var i = 0u; i < 3u; i++) {
    value += 0.125;
  }
  return vec4f(value, 0.25, 0.75, 1.0);
}
```

Stops show locals **before** the highlighted statement executes. Braced `else if` chains are supported: taken branch bodies are recorded, while the whole chain has one outer condition site. Step Over visits subsequent recorded statements, including repeated loop-body visits. Continue searches unconditional line breakpoints. Step Back and reverse continue navigate the same recording without recompilation. Helpers execute normally, but Step Into currently behaves as Step Over; Step Out and call stacks are not implemented. Loop control headers are recorded on entry, while body statements are recorded on each execution.

The debugger highlights the original shader editor with its normal syntax highlighting. Set breakpoints there. Stepping may move the existing inspector with the editor cursor; its capture implementation is unchanged. Recorded trace values remain frozen from launch. Editing the original shader invalidates the session; stop and launch again for new values. Closing the GPU runner panel ends the session.

Recorded locals: `f32`, `i32`, `u32`, `bool`, and numeric vectors with two to four components. Other visible locals (including arrays, matrices and structs) remain listed as `<not recorded: unsupported or unresolved type>`; they do not prevent stepping or change shader execution. The Debug Console reports these values at launch. Integer values retain their bits. There are at most 16 recorded locals per site and 16384 events per recording. Overflow is reported explicitly: recording stops, but shader loops continue normally. The GPU runner has a 30-second capture deadline; a hung shader may still hit the browser's GPU watchdog.

This PoC supports only a single source file with `fn mainImage(coord: vec2f) -> vec4f`. Project channels, Common files, storage, scripts, authored GPU entry points/bindings and optional GPU features are not supported. Aggregate/pointer values are not recorded. Conditional/hit/log breakpoints and arbitrary expression evaluation are deferred. Evaluate accepts exact recorded variable names.

Supply explicit custom uniforms in the launch configuration, for example:

```json
"customUniforms": [
  { "name": "uRed", "type": "float", "value": 0.5 },
  { "name": "uGreen", "type": "float", "value": 1.0 },
  { "name": "uOffset", "type": "float", "value": 0.0 }
]
```

Types are `float`, `vec2`, `vec3`, `vec4` and `bool`; vector values are numeric arrays and bool values are booleans. Names must be unique WGSL identifiers, excluding built-ins/generated names and authored global declarations, with at most 32 uniforms. Values are validated before capture. Manual launches supply these explicitly. Start Trace snapshots the preview's current custom uniform values, including those produced by scripts; it does not re-run the scripts.

Tracing creates a separate GPU device and offscreen target for each launch. It never installs an instrumented shader into the preview. The existing inspector may follow debugger cursor movements in the original editor. Active capture still consumes GPU time. This is a PoC for deterministic fragment execution, not a guarantee of reproducing races or previously rendered resource state.

Tracked in private [debugger issue #32](https://github.com/teaqu/shader-studio-dev/issues/32).

## Corpus validation

Run `npm run test:e2e:corpus -w @shader-studio/rendering` after building the workspace dependencies. This runs the existing rendering/inspector corpus and the WGSL trace corpus on Chromium WebGPU, plus source-inventory unit tests.

The bundled corpus contains 123 configured projects across GLSL, Slang and WGSL, including 45 WGSL roots. The trace sweep inventories all 93 WGSL source files, including auxiliary passes. Twelve sources capture successfully as isolated fullscreen fragments; their output is compared with an uninstrumented `rgba32float` render at three pixels/times/frames and again with a one-event capacity. Recorded coordinates and UV values are checked independently. The custom-uniform fixture uses its explicit `uRed`/`uGreen`/`uOffset` inputs. This tests source execution under explicit launch inputs; configured geometry, resources and earlier pass state are outside this capture.

The remaining 81 sources have per-file expected refusals: 23 authored GPU entry/binding files, 12 auxiliary files without `mainImage`, 45 missing channel/Common/storage/custom-uniform dependencies and one shader exceeding the 16-recorded-local budget. Aggregate types and `else if` no longer cause blanket refusals; missing dependencies reach the compiler and report the actual missing symbol. These are asserted refusals, not successful captures or skipped tests. An unclassified fixture or changed refusal fails the sweep so compatibility changes require review. The current cross-language renderer and inspector suite remains a separate regression check.
