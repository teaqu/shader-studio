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

To trace the preview, enable the pixel inspector, select a pixel, choose a pass/stage, and click **Start Trace**. Image fragment is the default. Compute targets expose an invocation `[x, y, z]`; vertex targets expose a vertex index. Pixel selection is mapped to the selected pass resolution. Capture uses the installed project, including Common code, named channels, buffer feedback, storage, geometry, scripts’ current uniform values, and configured compute entry points/dispatches. If the current source differs from the installed preview, refresh it before tracing. This flow is available through VS Code and its connected preview host.

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

Stops show locals **before** the highlighted statement executes. Braced `else if` chains are supported: taken branch bodies are recorded, while the whole chain has one outer condition site. Step Over visits subsequent recorded statements, including repeated loop-body visits. Continue searches unconditional line breakpoints. Step Back and reverse continue navigate the same recording without recompilation. Project recordings include statements inside authored helpers and Common files, with original source paths and function names. Step Into currently navigates the same event stream as Step Over; Step Out and full caller stacks are not implemented. Loop control headers are recorded on entry, while body statements are recorded on each execution.

The debugger highlights the original shader editor with its normal syntax highlighting. Set breakpoints there. Stepping may move the existing inspector with the editor cursor; its capture implementation is unchanged. Recorded trace values remain frozen from launch. Editing any captured source invalidates the session; stop and launch again for new values. Project capture reuses the preview and original editors. Manual single-file launches still use a separate GPU runner panel; closing that panel ends the manual session.

Recorded locals: `f32`, `i32`, `u32`, `bool`, and numeric vectors with two to four components. Other visible locals (including arrays, matrices and structs) remain listed as `<not recorded: unsupported or unresolved type>`; they do not prevent stepping or change shader execution. The Debug Console reports these values at launch. Integer values retain their bits. There are at most 16384 events per recording; the number of locals is bounded by the GPU storage-buffer limit. Overflow is reported explicitly: recording stops, but shader loops continue normally. The manual GPU runner has a 30-second capture deadline; a hung shader may still hit the browser's GPU watchdog.

Manual launch configurations support self-contained `fn mainImage(coord: vec2f) -> vec4f` shaders with explicit inputs. Use **Start Trace** for configured project resources and compute/vertex targets. Vertex tracing replays the selected vertex invocation as compute because WebGPU forbids writable trace storage in the vertex stage. It uses cloned vertex data, uniforms, textures and storage; it does not pause a live vertex invocation. Aggregate/pointer values are not recorded. Conditional/hit/log breakpoints and arbitrary expression evaluation are deferred. Evaluate accepts exact recorded variable names.

Supply explicit custom uniforms in the launch configuration, for example:

```json
"customUniforms": [
  { "name": "uRed", "type": "float", "value": 0.5 },
  { "name": "uGreen", "type": "float", "value": 1.0 },
  { "name": "uOffset", "type": "float", "value": 0.0 }
]
```

Types are `float`, `vec2`, `vec3`, `vec4` and `bool`; vector values are numeric arrays and bool values are booleans. Names must be unique WGSL identifiers, excluding built-ins/generated names and authored global declarations, with at most 32 uniforms. Values are validated before capture. Manual launches supply these explicitly. Start Trace snapshots the preview's current custom uniform values, including those produced by scripts; it does not re-run the scripts.

Project capture runs on the preview GPU device with separate pipelines and offscreen targets. It clones sampled textures (including mip levels), storage, and mesh buffers before asynchronous compilation; compute writes target only trace-owned storage and outputs. It never installs an instrumented shader into the preview or swaps its pass buffers. The existing inspector may follow debugger cursor movements in the original editor. Active capture consumes GPU time. Feedback and compute are re-executed from the captured current resource state, rather than reconstructing a historical frame. Mesh fragment traces first select the depth-winning triangle on GPU, including coplanar draw-order ties, so overdraw cannot mix its recorded locals with another triangle. Atomic/racy shaders may produce different outcomes between runs; vertex replay is not a complete rasterization capture. Manual launches continue to create a separate GPU device.

Tracked in private [debugger issue #32](https://github.com/teaqu/shader-studio-dev/issues/32).

## Corpus validation

Run `npm run test:e2e:corpus -w @shader-studio/rendering` after building the workspace dependencies. This runs the existing rendering/inspector corpus and the WGSL trace corpus on Chromium WebGPU, plus source-inventory unit tests.

The project trace suite inventories all 93 WGSL files: 58 Image/fragment sources, 23 compute files, six vertex hooks, and six Common sources. All 45 configured WGSL projects are exercised, covering 87 configured passes and all 27 configured compute entry points, plus six vertex replays. The two unconfigured standalone sources remain covered by the explicit-input launch suite.

Every configured trace is compared with an uninstrumented capture for output and post-compute storage. The suite verifies original source locations, Common snapshots, nonempty event streams, unchanged live storage, and shader execution after trace capacity is exhausted. Stateless fullscreen Image cases also compare with the live canvas. The existing cross-language renderer/inspector corpus remains a separate regression check.

The standalone launch suite separately pins dependency errors when configured source files are launched without their resources. These source-only refusals do not represent project trace exclusions. Arrays, matrices, structs, full caller stacks, expression evaluation and conditional/hit/log breakpoints remain outside the recorded-value/navigation scope described above.

Verified through the macOS `ci-runner` bridge: 277 corpus browser tests and four inventory tests, five VS Code trace integration tests, 397 types tests, 797 debug tests, 2416 rendering tests, 3457 UI tests, and 22 DAP/configuration/host tests. Repository lint, full UI check, extension test compilation and extension/UI builds pass. Disabling visible-primitive gating reproduces mixed-triangle locals in all four mesh regressions; restoring it passes.

The gravity fixtures previously had a real cross-invocation storage race. Both WGSL and Slang versions now use one owning invocation with a local snapshot of force-source bodies for each of their four configured substeps. This keeps the small fixture deterministic while preserving its compatibility with the existing inspector; it is not a performance pattern for a large simulation.
