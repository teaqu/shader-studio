// Slang input-object smoke test for texture, audio, keyboard, and cubemap channels.
//
// Quadrants: texture (top-left), audio (top-right), keyboard (bottom-left),
// cubemap (bottom-right). Each panel samples through inputs.iChannelN and has a
// status strip that is green only when size, loaded, and time metadata match.

float box(float2 uv, float2 lo, float2 hi)
{
    float2 insideLo = step(lo, uv);
    float2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float metadataMatches(uint2 actualSize, uint2 expectedSize, bool loaded, float time, bool timeRuns)
{
    bool sizeOk = all(actualSize == expectedSize);
    bool timeOk = timeRuns ? time >= 0.0 : abs(time) < 0.01;
    return sizeOk && loaded && timeOk ? 1.0 : 0.0;
}

float3 statusColor(float ok)
{
    return lerp(float3(0.85, 0.025, 0.025), float3(0.025, 0.85, 0.10), ok);
}

float keyValue(float keyCode, float row)
{
    float2 keyUv = float2((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return inputs.iChannel2.Sample(keyUv).r;
}

float3 texturePanel(float2 p)
{
    // The source has red/green/blue/yellow edges at top/left/bottom/right.
    // Sampling the full panel makes a vertical inversion immediately visible.
    return inputs.iChannel0.Sample(p).rgb;
}

float3 audioPanel(float2 p)
{
    float spectrum = inputs.iChannel1.Sample(float2(p.x, 0.25)).r;
    float waveform = inputs.iChannel1.Sample(float2(p.x, 0.75)).r;
    float3 col = float3(0.015, 0.025, 0.045);
    col += (p.y < spectrum * 0.82 ? 1.0 : 0.0) * float3(0.02, 0.75, 0.95);
    float waveY = 0.52 + (waveform - 0.5) * 0.55;
    col += (abs(p.y - waveY) < 0.018 ? 1.0 : 0.0) * float3(1.0, 0.85, 0.05);
    float marker = frac(inputs.iChannel1.time / 5.0);
    col = lerp(col, float3(1.0, 1.0, 1.0), abs(p.x - marker) < 0.006 ? 0.8 : 0.0);
    return col;
}

float3 keyboardPanel(float2 p)
{
    float aHeld = keyValue(65.0, 0.0);
    float sHeld = keyValue(83.0, 0.0);
    float dHeld = keyValue(68.0, 0.0);
    float spacePressed = keyValue(32.0, 1.0);
    float3 col = float3(0.025, 0.03, 0.05);
    col += box(p, float2(0.08, 0.18), float2(0.30, 0.78)) * aHeld * float3(1.0, 0.04, 0.03);
    col += box(p, float2(0.39, 0.18), float2(0.61, 0.78)) * sHeld * float3(0.03, 1.0, 0.08);
    col += box(p, float2(0.70, 0.18), float2(0.92, 0.78)) * dHeld * float3(0.04, 0.20, 1.0);
    col += box(p, float2(0.08, 0.84), float2(0.92, 0.94)) * spacePressed;
    return col;
}

float3 cubemapPanel(float2 p)
{
    float yaw = (p.x * 2.0 - 1.0) * 1.75;
    float pitch = (p.y * 2.0 - 1.0) * 1.05;
    float3 dir = normalize(float3(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    float3 col = inputs.iChannel3.Sample(dir).rgb;

    // Six small direction probes, left to right: +X, -X, +Y, -Y, +Z, -Z.
    // Sample every direction before the fragment-varying branch: WGSL's
    // implicit-derivative texture sampling requires uniform control flow.
    float3 posX = inputs.iChannel3.Sample(float3(1.0, 0.0, 0.0)).rgb;
    float3 negX = inputs.iChannel3.Sample(float3(-1.0, 0.0, 0.0)).rgb;
    float3 posY = inputs.iChannel3.Sample(float3(0.0, 1.0, 0.0)).rgb;
    float3 negY = inputs.iChannel3.Sample(float3(0.0, -1.0, 0.0)).rgb;
    float3 posZ = inputs.iChannel3.Sample(float3(0.0, 0.0, 1.0)).rgb;
    float3 negZ = inputs.iChannel3.Sample(float3(0.0, 0.0, -1.0)).rgb;
    float probe = floor(p.x * 6.0);
    if (p.y < 0.15)
    {
        if (probe < 1.0) col = posX;
        else if (probe < 2.0) col = negX;
        else if (probe < 3.0) col = posY;
        else if (probe < 4.0) col = negY;
        else if (probe < 5.0) col = posZ;
        else col = negZ;
    }
    return col;
}

float4 mainImage(float2 fragCoord)
{
    float2 uv = fragCoord / iResolution.xy;
    float2 panelUv = frac(uv * 2.0);
    // Evaluate all implicit-derivative samples in uniform control flow, then
    // select the visible quadrant from the already-sampled values.
    float3 textureCol = texturePanel(panelUv);
    float3 audioCol = audioPanel(panelUv);
    float3 keyboardCol = keyboardPanel(panelUv);
    float3 cubemapCol = cubemapPanel(panelUv);
    float3 col;
    float metadataOk;

    if (uv.y >= 0.5 && uv.x < 0.5)
    {
        col = textureCol;
        metadataOk = metadataMatches(inputs.iChannel0.size, uint2(256, 256), inputs.iChannel0.loaded, inputs.iChannel0.time, false);
    }
    else if (uv.y >= 0.5)
    {
        col = audioCol;
        metadataOk = metadataMatches(inputs.iChannel1.size, uint2(512, 2), inputs.iChannel1.loaded, inputs.iChannel1.time, true);
    }
    else if (uv.x < 0.5)
    {
        col = keyboardCol;
        metadataOk = metadataMatches(inputs.iChannel2.size, uint2(256, 3), inputs.iChannel2.loaded, inputs.iChannel2.time, false);
    }
    else
    {
        col = cubemapCol;
        metadataOk = metadataMatches(inputs.iChannel3.size, uint2(128, 128), inputs.iChannel3.loaded, inputs.iChannel3.time, false);
    }

    // Green is success, red exposes the panel whose metadata is wrong.
    if (panelUv.y > 0.96) col = statusColor(metadataOk);
    if (abs(uv.x - 0.5) < 0.003 || abs(uv.y - 0.5) < 0.003) col = float3(1.0, 1.0, 1.0);
    return float4(saturate(col), 1.0);
}
