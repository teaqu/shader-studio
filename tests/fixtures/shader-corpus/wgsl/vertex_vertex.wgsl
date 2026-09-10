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
    (*position).xy = (*position).xy * transform.xy + transform.zw;

    let channelColor = iChannel3SampleLevel(*uv, 0.0).rgb;
    // NOTE: plain assignment — see intellisense.vert.wgsl.
    (*position).xy = (*position).xy + (channelColor.rg - vec2f(0.5)) * 0.16;
}
