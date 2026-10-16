// Original 32³ uniform noise, sampled with LINEAR + REPEAT.
float4 readNoise(float3 p) { return iChannel0.SampleLevel( p, 0.0); }
float4 mainImage(float2 fragCoord) {
    float2 uv = fragCoord / iResolution.xy;
    float panel = floor(uv.x * 3.0);
    float2 q = float2(frac(uv.x * 3.0), uv.y);
    float3 p = float3(q * 0.7, iTime * 0.04);
    float3 result;
    if (panel < 1.0) {
        result = float3(readNoise(p).r);
    } else if (panel < 2.0) {
        float value = 0.0; float weight = 0.5;
        for (int octave = 0; octave < 4; octave++) {
            value += readNoise(p).r * weight;
            p = p * 2.03 + float3(0.17,0.31,0.23); weight *= 0.5;
        }
        result = float3(value / 0.9375);
    } else {
        float value = readNoise(p * 0.25).r;
        result = lerp(float3(0.05,0.12,0.23), float3(1.0,0.85,0.55), smoothstep(0.25,0.75,value));
    }
    result *= step(0.015,q.x) * step(q.x,0.985);
    return float4(result,1.0);
}
