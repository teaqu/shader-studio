// WGSL vertex-hook IntelliSense fixture.
// WGSL mirror of ../slang/intellisense.vert.slang.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    // NOTE: WGSL assigns single components only. Chromium's compiler accepts a
    // multi-component swizzle store, VS Code's rejects it, so keep the portable
    // form: build the new value, then write x and y separately.
    let nudged = (*position).xy + (*uv - vec2f(0.5)) * 0.02;
    (*position).x = nudged.x;
    (*position).y = nudged.y;
    *normal = normalize(*normal);
    *uv = clamp(*uv, vec2f(0.0), vec2f(1.0));
}
