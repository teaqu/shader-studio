// Model wobble hook for the two-meshes WGSL test.
// WGSL mirror of ../slang/visor.vertex.slang.

fn mainVertex(position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>, uv: ptr<function, vec2<f32>>) {
    (*position).x *= sin(iTime);
    (*position).y *= cos(iTime);
    (*position).z *= sin(iTime * 0.5);
}
