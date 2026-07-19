// Launchable Image entrypoint paired with particles.sha.json.
float4 mainImage(float2 fragCoord)
{
    return renderParticles(fragCoord);
}
