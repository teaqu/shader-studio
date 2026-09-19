// Channel-offset vertex hook for the WGSL feature-coverage test.
// WGSL mirror of ../slang/feature-coverage.vert.slang. Nudges vertices by
// the sampled pattern texture, proving vertex hooks can read channels.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    let channelOffset = patternTexSampleLevel(*uv, 0.0).rg - 0.5;
    // NOTE: WGSL assigns single components only. Chromium's compiler accepts a
    // multi-component swizzle store, VS Code's rejects it, so keep the portable
    // form: build the new value, then write x and y separately.
    let nudged = (*position).xy + channelOffset * 0.04;
    (*position).x = nudged.x;
    (*position).y = nudged.y;
}
