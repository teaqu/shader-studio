// WGSL vertex-hook IntelliSense fixture.
// WGSL mirror of ../slang/intellisense.vert.slang.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    // NOTE: stage through a local — some Tint versions reject a store to a
    // multi-component swizzle through a pointer dereference entirely
    // ("cannot assign to value of type 'swizzle<...>'"), not just compound
    // assignment. A swizzle store to a function-scope var is accepted
    // everywhere, so copy out, nudge, and write back.
    var pos = *position;
    pos.xy = pos.xy + (*uv - vec2f(0.5)) * 0.02;
    *position = pos;
    *normal = normalize(*normal);
    *uv = clamp(*uv, vec2f(0.0), vec2f(1.0));
}
