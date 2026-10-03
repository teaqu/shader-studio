# WGSL step debugger proof of concept

The experimental **Shader Studio WGSL Trace (PoC)** debugger records execution on WebGPU, then uses VS Code's debug toolbar to navigate that recording. The existing Shader Studio preview and variable inspector use their original code and state.

Launch a self-contained `.wgsl` fragment shader from Run and Debug with:

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

`pixel` uses a top-left origin. The shader receives ordinary bottom-left `mainImage` coordinates. The runner renders at the specified resolution, preserving neighbouring fragment execution and derivatives; only the selected pixel records events. Launch inputs are independent of the preview. Mouse/date/camera inputs are zero, sample rate is 44100, and time/frame are explicit.

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

Stops show locals **before** the highlighted statement executes. Step Over visits subsequent recorded statements, including repeated loop-body visits. Continue searches unconditional line breakpoints. Step Back and reverse continue navigate the same recording without recompilation. Helpers execute normally, but Step Into currently behaves as Step Over; Step Out and call stacks are not implemented. Loop control headers are recorded on entry, while body statements are recorded on each execution.

The debugger opens a read-only source snapshot with a separate document name, so stepping does not send shader-cursor updates to the existing inspector. Set initial breakpoints in the original file or add them to the recording. Editing the original shader invalidates the session; stop and launch again for new values. Closing the GPU runner panel ends the session.

Supported locals: `f32`, `i32`, `u32`, `bool`, and numeric vectors with two to four components. Integer values retain their bits. There are at most 16 recorded locals per site and 16384 events per recording. Overflow is reported explicitly: recording stops, but shader loops continue normally. The GPU runner has a 30-second capture deadline; a hung shader may still hit the browser's GPU watchdog.

This PoC supports only a single source file with `fn mainImage(coord: vec2f) -> vec4f`. Project channels, Common files, storage, scripts, custom uniforms, authored GPU entry points/bindings, optional GPU features, matrices, structs, arrays and pointers are not supported. Use braced `else` blocks rather than `else if`. Conditional/hit/log breakpoints and arbitrary expression evaluation are deferred. Evaluate accepts exact recorded variable names.

Tracing creates a separate GPU device and offscreen target for each launch. It never installs an instrumented shader into the preview or calls the existing inspector managers. Active capture still consumes GPU time. This is a PoC for deterministic fragment execution, not a guarantee of reproducing races or previously rendered resource state.

Tracked in private [debugger issue #32](https://github.com/teaqu/shader-studio-dev/issues/32).
