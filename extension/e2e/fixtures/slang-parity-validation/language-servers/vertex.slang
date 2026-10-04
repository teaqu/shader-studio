void mainVertex(uint vertexIndex, inout float3 deformed, inout float3 surfaceNormal, inout float2 textureUv) {
    deformed += surfaceNormal * textureUv.x;
}
