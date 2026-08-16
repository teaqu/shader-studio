import lib.palette;

float shade(float value) {
    return twice(value) * 0.5;
}

float4 mainImage(float2 pixelPosition) {
    float4 literalColor = float4(1.0, 0.5, 0.0, 1.0);
    float2 uv = pixelPosition / iResolution.xy;
    float remainder = fmod(literalColor.x, 0.75);
    return sampleIChannel0(uv) + float4(shade(remainder));
}
