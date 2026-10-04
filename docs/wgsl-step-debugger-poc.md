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

Stops show locals **before** the highlighted statement executes. Braced `else if` chains are supported: taken branch bodies are recorded, while the whole chain has one outer condition site. Step Over skips nested function calls while preserving callee breakpoints. Step Into visits the next recorded statement; Step Out advances until the current dynamic call returns. Continue searches unconditional line breakpoints. Step Back and reverse continue navigate the same recording without recompilation. Project recordings include statements inside authored helpers and Common files, with original source paths and function names. Caller stacks retain the locals recorded before each call; repeated calls have distinct frame IDs. Fixed arrays, structs and f32 matrices expand into child values in VS Code. Captures are bounded to 16 aggregate levels, 256 packed leaves per root and 1024 per statement; pointers, runtime arrays, atomics, f16 and unresolved sizes remain explicitly unavailable. Loop control headers are recorded on entry, while body statements are recorded on each execution.

The debugger highlights the original shader editor with its normal syntax highlighting. Set breakpoints there. Stepping may move the existing inspector with the editor cursor; its capture implementation is unchanged. Recorded trace values remain frozen from launch. Editing any captured source invalidates the session; stop and launch again for new values. Project capture reuses the preview and original editors. Manual single-file launches still use a separate GPU runner panel; closing that panel ends the manual session.

Recorded locals: `f32`, `i32`, `u32`, `bool`, vectors with two to four components, fixed arrays, structs, and f32 matrices. Aggregate leaves retain their scalar/vector representations and nested children. Unsupported, oversized or unresolved roots remain listed as `<not recorded: unsupported or unresolved type>`; they do not prevent stepping or change shader execution. The Debug Console reports these values at launch. Integer values retain their bits. There are at most 16384 events per recording; the number of locals is bounded by the GPU storage-buffer limit. Overflow is reported explicitly: recording stops, but shader loops continue normally. The manual GPU runner has a 30-second capture deadline; a hung shader may still hit the browser's GPU watchdog.

Manual launch configurations support self-contained `fn mainImage(coord: vec2f) -> vec4f` shaders with explicit inputs. Use **Start Trace** for configured project resources and compute/vertex targets. Vertex tracing replays the selected vertex invocation as compute because WebGPU forbids writable trace storage in the vertex stage. It uses cloned vertex data, uniforms, textures and storage; it does not pause a live vertex invocation. Pointers, atomics, runtime arrays and f16 values are not recorded. Conditional/hit/log breakpoints and arbitrary expression evaluation are deferred. Evaluate accepts exact recorded local paths, including struct fields and fixed array indices, in the selected frame.

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

The standalone launch suite separately pins dependency errors when configured source files are launched without their resources. These source-only refusals do not represent project trace exclusions. Arbitrary expression evaluation and conditional/hit/log breakpoints remain outside the recorded-value/navigation scope described above. Aggregate array sizes resolve literal arithmetic and module-level integer constants; unresolved expressions and pipeline overrides remain unavailable.

Verified through the macOS `ci-runner` bridge: 277 corpus browser tests and four inventory tests, five VS Code trace integration tests, 402 types tests, 821 debug tests, 2416 rendering tests, 3457 UI tests, and 25 DAP/configuration/host tests. Fourteen dedicated GPU trace tests cover aggregate decoding, nested/repeated calls, void/early returns, typed returns and unchanged shader output. The aggregate/caller regressions fail against the prior backend and pass after restoring the implementation. Repository lint, full UI check, extension test compilation and extension/UI builds pass. Disabling visible-primitive gating reproduces mixed-triangle locals in all four mesh regressions; restoring it passes.

The gravity fixtures previously had a real cross-invocation storage race. Both WGSL and Slang versions now use one owning invocation with a local snapshot of force-source bodies for each of their four configured substeps. This keeps the small fixture deterministic while preserving its compatibility with the existing inspector; it is not a performance pattern for a large simulation.
