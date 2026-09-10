void mainVertex(inout vec3 position, inout vec3 normal, inout vec2 uv)
{
    vec2 channelOffset = samplePatternTex(uv).rg - 0.5;
    position.xy += channelOffset * 0.04;
}
