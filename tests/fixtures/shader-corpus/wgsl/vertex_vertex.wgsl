// Custom WGSL vertex hook with storage + channel access.
// WGSL mirror of ../slang/vertex_vertex.slang.
//
// Like the Slang version, this hook reads `vertexTransform` (initialized by
// the ComputeInit pass) from render-stage storage and samples its pass's
// iChannel3 input with an explicit level (SampleLevel is required outside
// fragment shaders). The triangle lands inset and offset rather than
// fullscreen: scale ~(0.62, 0.58), offset (0.16, -0.12), plus a small
// texture-driven wobble.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    let transform = vertexTransform[0];
    // NOTE: WGSL assigns single components only. Chromium's compiler accepts a
    // multi-component swizzle store, VS Code's rejects it, so keep the portable
    // form: build the new value, then write x and y separately.
    let placed = (*position).xy * transform.xy + transform.zw;
    (*position).x = placed.x;
    (*position).y = placed.y;

    let channelColor = iChannel3SampleLevel(*uv, 0.0).rgb;
    let wobbled = (*position).xy + (channelColor.rg - vec2f(0.5)) * 0.16;
    (*position).x = wobbled.x;
    (*position).y = wobbled.y;
}
