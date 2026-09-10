// Initialize a visible transform so vertex_vertex.slang proves that a custom
// vertex stage can read a storage buffer written by an earlier compute pass.
[shader("compute")]
[numthreads(1, 1, 1)]
void initializeVertexTransform(uint3 tid : SV_DispatchThreadID)
{
    if (tid.x == 0u)
    {
        vertexTransform[0] = float4(0.62, 0.58, 0.16, -0.12);
    }
}
