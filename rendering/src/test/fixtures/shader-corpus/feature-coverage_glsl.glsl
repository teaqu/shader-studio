void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 centered = uv - 0.5;
    float angle = 0.15 + uFloat * 0.2;
    float sine = sin(angle);
    float cosine = cos(angle);
    vec2 rotated = mat2(cosine, sine, -sine, cosine) * centered + 0.5;

    float weights[3] = float[3](0.2, 0.3, 0.5);
    float weighted = 0.0;
    for (int index = 0; index < 3; ++index)
    {
        weighted += weights[index];
    }

    CoverageSample sampleValue;
    sampleValue.color = texture(patternTex, rotated).rgb;
    sampleValue.energy = dot(sampleValue.color, vec3(0.299, 0.587, 0.114));
    vec3 history = texture(historyBuffer, uv).rgb;
    float edge = clamp(length(vec2(dFdx(sampleValue.energy), dFdy(sampleValue.energy))) * 8.0, 0.0, 1.0);
    uint flags = (uint(iFrame) & 1u) | 2u;
    float flagValue = flags == 2u ? 1.0 : 0.75;
    float channelReady = iChannelResolution[0].x > 0.0 ? 1.0 : 0.0;

    vec3 color = mix(coverageGain(sampleValue.color), history, 0.35);
    color += coveragePalette(uv.y * 4.0 + iTime) * edge * 0.15;
    color *= weighted * flagValue * channelReady;
    color = mix(color, uVec3, uBool ? 0.08 : 0.0);
    color += vec3(uVec2, uVec4.x) * 0.03;
    fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
