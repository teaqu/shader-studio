// Standalone Image pass source. Shader Studio launches particles.slang because
// the main shader and particles.sha.json must share a basename.
float4 mainImage(float2 fragCoord)
{
    return renderParticles(fragCoord);
}
