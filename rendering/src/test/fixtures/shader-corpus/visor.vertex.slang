void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {
    position.x *= sin(iTime);
    position.y *= cos(iTime);
    position.z *= sin(iTime * 0.5);
}
