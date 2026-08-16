// Cubemap input smoke test for Slang/WebGPU.
//
// Config: cubemap.sha.json binds assets/cubemap-cross.svg to iChannel0.
// Expected face colors: +X red, -X green, +Y blue, -Y yellow,
// +Z magenta, -Z cyan. The left swatches sample those six directions.

float box(float2 uv, float2 lo, float2 hi)
{
    float2 insideLo = step(lo, uv);
    float2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float3 fallbackGrid(float2 uv)
{
    float2 cells = abs(frac(uv * 16.0) - 0.5);
    float line = 1.0 - smoothstep(0.46, 0.50, min(cells.x, cells.y));
    return lerp(float3(0.035, 0.038, 0.048), float3(0.14, 0.14, 0.16), line * 0.35);
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;

    float yaw = p.x * 1.55;
    float pitch = p.y * 0.95;
    float3 dir = normalize(float3(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    float3 cube = sampleIChannel0(dir).rgb;
    float3 col = lerp(fallbackGrid(uv), cube, 0.96);

    float3 posX = sampleIChannel0(float3(1.0, 0.0, 0.0)).rgb;
    float3 negX = sampleIChannel0(float3(-1.0, 0.0, 0.0)).rgb;
    float3 posY = sampleIChannel0(float3(0.0, 1.0, 0.0)).rgb;
    float3 negY = sampleIChannel0(float3(0.0, -1.0, 0.0)).rgb;
    float3 posZ = sampleIChannel0(float3(0.0, 0.0, 1.0)).rgb;
    float3 negZ = sampleIChannel0(float3(0.0, 0.0, -1.0)).rgb;

    if (box(uv, float2(0.06, 0.80), float2(0.18, 0.92)) > 0.0) col = posX;
    if (box(uv, float2(0.06, 0.66), float2(0.18, 0.78)) > 0.0) col = negX;
    if (box(uv, float2(0.06, 0.52), float2(0.18, 0.64)) > 0.0) col = posY;
    if (box(uv, float2(0.06, 0.38), float2(0.18, 0.50)) > 0.0) col = negY;
    if (box(uv, float2(0.06, 0.24), float2(0.18, 0.36)) > 0.0) col = posZ;
    if (box(uv, float2(0.06, 0.10), float2(0.18, 0.22)) > 0.0) col = negZ;

    return float4(saturate(col), 1.0);
}
