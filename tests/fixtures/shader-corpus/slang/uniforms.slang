// Custom + remaining ShaderToy uniform parity test for Slang/WebGPU.
//
// Top row, left to right: float, vec2, vec3, vec4, bool. All panels should
// animate; the bool panel alternates green/blue once per second.
// Middle strips: iCameraPos and iCameraDir. Bottom row: iDate, then
// Input metadata checks for texture, audio, and keyboard. Every status tile
// should be green.

float box(float2 uv, float2 lo, float2 hi)
{
    float2 insideLo = step(lo, uv);
    float2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float resolutionMatches(uint2 actual, uint2 expected)
{
    return all(actual == expected) ? 1.0 : 0.0;
}

float3 statusColor(float ok)
{
    return lerp(float3(0.85, 0.03, 0.03), float3(0.03, 0.85, 0.12), ok);
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float3 col = float3(0.025, 0.03, 0.045);

    // Five custom-uniform panels.
    float floatPanel = box(uv, float2(0.03, 0.54), float2(0.18, 0.94));
    float floatFill = box(uv, float2(0.03, 0.54), float2(0.18, 0.54 + 0.40 * uFloat));
    col = lerp(col, float3(0.10, 0.10, 0.12), floatPanel);
    col = lerp(col, float3(uFloat, uFloat, uFloat), floatFill);

    float vec2Panel = box(uv, float2(0.23, 0.54), float2(0.38, 0.94));
    col = lerp(col, float3(uVec2.x, uVec2.y, 0.15), vec2Panel);

    float vec3Panel = box(uv, float2(0.43, 0.54), float2(0.58, 0.94));
    col = lerp(col, uVec3, vec3Panel);

    float vec4Panel = box(uv, float2(0.63, 0.54), float2(0.78, 0.94));
    col = lerp(col, uVec4.rgb, vec4Panel);
    float alphaBand = box(uv, float2(0.63, 0.54), float2(0.78, 0.54 + 0.40 * uVec4.a));
    col = lerp(col, float3(1.0, 1.0, 1.0), alphaBand * 0.35);

    float boolPanel = box(uv, float2(0.83, 0.54), float2(0.97, 0.94));
    float3 boolColor = uBool ? float3(0.05, 0.9, 0.15) : float3(0.05, 0.2, 0.95);
    col = lerp(col, boolColor, boolPanel);

    // Camera position is compressed into RGB around mid-grey so movement in
    // either direction remains visible. Camera direction maps [-1, 1] to
    // [0, 1]; its default (0, 0, -1) is yellow. The small direction badge is
    // green only while iCameraDir remains normalized.
    float3 cameraPosColor = 0.5 + 0.45 * iCameraPos / (1.0 + abs(iCameraPos));
    float3 cameraDirColor = 0.5 + 0.5 * iCameraDir;
    col = lerp(col, cameraPosColor, box(uv, float2(0.03, 0.455), float2(0.48, 0.515)));
    col = lerp(col, cameraDirColor, box(uv, float2(0.52, 0.455), float2(0.97, 0.515)));
    float cameraDirOk = abs(length(iCameraDir) - 1.0) < 0.01 ? 1.0 : 0.0;
    col = lerp(col, statusColor(cameraDirOk), box(uv, float2(0.93, 0.465), float2(0.96, 0.505)));

    // Date is considered valid when its calendar fields and seconds-of-day
    // are in range. The moving white band makes live iDate updates visible.
    float dateOk = iDate.x >= 2024.0 && iDate.y >= 0.0 && iDate.y <= 11.0 &&
        iDate.z >= 1.0 && iDate.z <= 31.0 && iDate.w >= 0.0 && iDate.w < 86400.0
        ? 1.0 : 0.0;
    float datePanel = box(uv, float2(0.03, 0.10), float2(0.18, 0.42));
    col = lerp(col, statusColor(dateOk), datePanel);
    float secondsBand = box(
        uv,
        float2(0.03, 0.10),
        float2(0.03 + 0.15 * frac(iDate.w / 60.0), 0.14)
    );
    col = lerp(col, float3(1.0, 1.0, 1.0), secondsBand);

    float4 checks = float4(
        resolutionMatches(inputs.iChannel0.size, uint2(256, 256)) * (inputs.iChannel0.loaded ? 1.0 : 0.0),
        resolutionMatches(inputs.iChannel1.size, uint2(512, 2)) * (inputs.iChannel1.loaded ? 1.0 : 0.0),
        resolutionMatches(inputs.iChannel2.size, uint2(256, 3)) * (inputs.iChannel2.loaded ? 1.0 : 0.0),
        1.0
    );
    col = lerp(col, statusColor(checks.x), box(uv, float2(0.23, 0.10), float2(0.38, 0.42)));
    col = lerp(col, statusColor(checks.y), box(uv, float2(0.43, 0.10), float2(0.58, 0.42)));
    col = lerp(col, statusColor(checks.z), box(uv, float2(0.63, 0.10), float2(0.78, 0.42)));
    col = lerp(col, statusColor(checks.w), box(uv, float2(0.83, 0.10), float2(0.97, 0.42)));

    // Exercise input sampling and input time as live values rather than merely
    // compiling their fields. The texture-center swatch sits in the texture
    // tile; the audio-time bar grows across the bottom of the audio tile.
    float3 textureProbe = inputs.iChannel0.Sample(float2(0.25, 0.75)).rgb;
    col = lerp(col, textureProbe, box(uv, float2(0.25, 0.34), float2(0.36, 0.40)));
    float audioTimeBand = box(
        uv,
        float2(0.43, 0.10),
        float2(0.43 + 0.15 * frac(inputs.iChannel1.time / 10.0), 0.14)
    );
    col = lerp(col, float3(1.0, 1.0, 1.0), audioTimeBand);

    return float4(saturate(col), 1.0);
}
