// Shader Studio supplies the entry point and invokes this hook for each
// fullscreen vertex. iChannel3 is sampled at mip level 0 in the vertex stage.
void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    vec3 channelColor = sampleIChannel3(uv).rgb;
    position.xy = position.xy * 0.72 + (channelColor.rg - 0.5) * 0.16;
}
