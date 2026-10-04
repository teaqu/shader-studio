void mainVertex(int vertexIndex, inout vec3 deformed, inout vec3 surfaceNormal, inout vec2 textureUv) {
    deformed += surfaceNormal * textureUv.x;
}
