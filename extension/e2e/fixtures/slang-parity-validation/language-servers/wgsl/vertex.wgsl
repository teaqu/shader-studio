fn mainVertex(vertexIndex: u32, deformed: ptr<function, vec3<f32>>, surfaceNormal: ptr<function, vec3<f32>>, textureUv: ptr<function, vec2<f32>>) {
    *deformed += *surfaceNormal * (*textureUv).x;
}
