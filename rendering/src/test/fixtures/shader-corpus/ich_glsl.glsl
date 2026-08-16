// GLSL/WebGL reference for ich.slang. Expected output is identical.

float box(vec2 uv, vec2 lo, vec2 hi)
{
    vec2 insideLo = step(lo, uv);
    vec2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float metadataMatches(vec3 actualSize, vec3 expectedSize, int loaded, float time, bool timeRuns)
{
    bool sizeOk = all(lessThan(abs(actualSize - expectedSize), vec3(0.5)));
    bool timeOk = timeRuns ? time >= 0.0 : abs(time) < 0.01;
    return sizeOk && loaded != 0 && timeOk ? 1.0 : 0.0;
}

vec3 statusColor(float ok)
{
    return mix(vec3(0.85, 0.025, 0.025), vec3(0.025, 0.85, 0.10), ok);
}

float keyValue(float keyCode, float row)
{
    vec2 keyUv = vec2((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return texture(iCh2.sampler, keyUv).r;
}

vec3 texturePanel(vec2 p)
{
    return texture(iCh0.sampler, p).rgb;
}

vec3 audioPanel(vec2 p)
{
    float spectrum = texture(iCh1.sampler, vec2(p.x, 0.25)).r;
    float waveform = texture(iCh1.sampler, vec2(p.x, 0.75)).r;
    vec3 col = vec3(0.015, 0.025, 0.045);
    col += (p.y < spectrum * 0.82 ? 1.0 : 0.0) * vec3(0.02, 0.75, 0.95);
    float waveY = 0.52 + (waveform - 0.5) * 0.55;
    col += (abs(p.y - waveY) < 0.018 ? 1.0 : 0.0) * vec3(1.0, 0.85, 0.05);
    float marker = fract(iCh1.time / 5.0);
    col = mix(col, vec3(1.0), abs(p.x - marker) < 0.006 ? 0.8 : 0.0);
    return col;
}

vec3 keyboardPanel(vec2 p)
{
    float aHeld = keyValue(65.0, 0.0);
    float sHeld = keyValue(83.0, 0.0);
    float dHeld = keyValue(68.0, 0.0);
    float spacePressed = keyValue(32.0, 1.0);
    vec3 col = vec3(0.025, 0.03, 0.05);
    col += box(p, vec2(0.08, 0.18), vec2(0.30, 0.78)) * aHeld * vec3(1.0, 0.04, 0.03);
    col += box(p, vec2(0.39, 0.18), vec2(0.61, 0.78)) * sHeld * vec3(0.03, 1.0, 0.08);
    col += box(p, vec2(0.70, 0.18), vec2(0.92, 0.78)) * dHeld * vec3(0.04, 0.20, 1.0);
    col += box(p, vec2(0.08, 0.84), vec2(0.92, 0.94)) * spacePressed;
    return col;
}

vec3 cubemapPanel(vec2 p)
{
    float yaw = (p.x * 2.0 - 1.0) * 1.75;
    float pitch = (p.y * 2.0 - 1.0) * 1.05;
    vec3 dir = normalize(vec3(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 col = texture(iCh3.sampler, dir).rgb;
    vec3 posX = texture(iCh3.sampler, vec3(1.0, 0.0, 0.0)).rgb;
    vec3 negX = texture(iCh3.sampler, vec3(-1.0, 0.0, 0.0)).rgb;
    vec3 posY = texture(iCh3.sampler, vec3(0.0, 1.0, 0.0)).rgb;
    vec3 negY = texture(iCh3.sampler, vec3(0.0, -1.0, 0.0)).rgb;
    vec3 posZ = texture(iCh3.sampler, vec3(0.0, 0.0, 1.0)).rgb;
    vec3 negZ = texture(iCh3.sampler, vec3(0.0, 0.0, -1.0)).rgb;
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

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 panelUv = fract(uv * 2.0);
    vec3 textureCol = texturePanel(panelUv);
    vec3 audioCol = audioPanel(panelUv);
    vec3 keyboardCol = keyboardPanel(panelUv);
    vec3 cubemapCol = cubemapPanel(panelUv);
    vec3 col;
    float metadataOk;

    if (uv.y >= 0.5 && uv.x < 0.5)
    {
        col = textureCol;
        metadataOk = metadataMatches(iCh0.size, vec3(256.0, 256.0, 1.0), iCh0.loaded, iCh0.time, false);
    }
    else if (uv.y >= 0.5)
    {
        col = audioCol;
        metadataOk = metadataMatches(iCh1.size, vec3(512.0, 2.0, 1.0), iCh1.loaded, iCh1.time, true);
    }
    else if (uv.x < 0.5)
    {
        col = keyboardCol;
        metadataOk = metadataMatches(iCh2.size, vec3(256.0, 3.0, 1.0), iCh2.loaded, iCh2.time, false);
    }
    else
    {
        col = cubemapCol;
        metadataOk = metadataMatches(iCh3.size, vec3(128.0, 128.0, 1.0), iCh3.loaded, iCh3.time, false);
    }

    if (panelUv.y > 0.96) col = statusColor(metadataOk);
    if (abs(uv.x - 0.5) < 0.003 || abs(uv.y - 0.5) < 0.003) col = vec3(1.0);
    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
