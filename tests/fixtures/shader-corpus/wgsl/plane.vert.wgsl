// Plane wave-displacement hook for the WGSL plane test.
// WGSL mirror of ../slang/plane.vert.slang.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    let wave = sin((*position).x * 5.0 + iTime) * cos((*position).z * 5.0 + iTime) * 0.2;
    (*position).y += wave;
}
