// Fullscreen ripple hook for the WGSL vertex test.
// WGSL mirror of ../slang/fullscreen-vertex.vert.slang.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    let ripple = sin((*uv).y * 20.0 + iTime) * 0.1;
    (*position).x += ripple;
    (*position).y += cos((*uv).x * 20.0 + iTime) * 0.1;
}
