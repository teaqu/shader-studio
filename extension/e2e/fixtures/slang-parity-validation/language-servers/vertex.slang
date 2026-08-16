void mainVertex(inout float3 deformed, inout float3 surfaceNormal, inout float2 textureUv) {
    deformed += surfaceNormal * textureUv.x;
}
