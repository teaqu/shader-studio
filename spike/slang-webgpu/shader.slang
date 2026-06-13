// Minimal Slang shader for the WebGPU spike.
// Demonstrates: a uniform (time), a vertex + fragment entry point, and a
// ShaderToy-flavoured animated gradient. Compiles to WGSL via slang-wasm.

struct Uniforms
{
    float time;
};

// Explicit binding so the generated WGSL lands on @group(0) @binding(0),
// which is what the WebGPU bind-group layout below expects.
[[vk::binding(0, 0)]]
ConstantBuffer<Uniforms> uniforms;

struct VSOutput
{
    float4 position : SV_Position;
    float2 uv : TEXCOORD0;
};

[shader("vertex")]
VSOutput vertexMain(uint vertexID : SV_VertexID)
{
    // Fullscreen triangle (covers the whole clip space with 3 verts).
    float2 verts[3] = { float2(-1, -1), float2(3, -1), float2(-1, 3) };
    float2 p = verts[vertexID];

    VSOutput out;
    out.position = float4(p, 0, 1);
    out.uv = p * 0.5 + 0.5;
    return out;
}

[shader("fragment")]
float4 fragmentMain(VSOutput in) : SV_Target
{
    // Classic iq palette animated by time — proves the uniform is plumbed.
    float3 col = 0.5 + 0.5 * cos(uniforms.time + in.uv.xyx + float3(0, 2, 4));
    return float4(col, 1.0);
}
