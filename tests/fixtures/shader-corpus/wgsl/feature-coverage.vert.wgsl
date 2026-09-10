// Channel-offset vertex hook for the WGSL feature-coverage test.
// WGSL mirror of ../slang/feature-coverage.vert.slang. Nudges vertices by
// the sampled pattern texture, proving vertex hooks can read channels.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    let channelOffset = patternTexSampleLevel(*uv, 0.0).rg - 0.5;
    // NOTE: stage through a local — some Tint versions reject a store to a
    // multi-component swizzle through a pointer dereference entirely
    // ("cannot assign to value of type 'swizzle<...>'"), not just compound
    // assignment. A swizzle store to a function-scope var is accepted
    // everywhere, so copy out, nudge, and write back.
    var pos = *position;
    pos.xy = pos.xy + channelOffset * 0.04;
    *position = pos;
}
