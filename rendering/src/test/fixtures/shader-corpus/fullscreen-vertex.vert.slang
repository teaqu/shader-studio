void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) {
    float ripple = sin(uv.y * 20.0 + iTime) * 0.1;
    position.x += ripple;
    position.y += cos(uv.x * 20.0 + iTime) * 0.1;
}
