// GLSL/WebGL reference for uniforms.slang. Expected output is identical.

float box(vec2 uv, vec2 lo, vec2 hi)
{
    vec2 insideLo = step(lo, uv);
    vec2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

float resolutionMatches(vec3 actual, vec3 expected)
{
    return all(lessThan(abs(actual - expected), vec3(0.5))) ? 1.0 : 0.0;
}

vec3 statusColor(float ok)
{
    return mix(vec3(0.85, 0.03, 0.03), vec3(0.03, 0.85, 0.12), ok);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = vec3(0.025, 0.03, 0.045);

    float floatPanel = box(uv, vec2(0.03, 0.54), vec2(0.18, 0.94));
    float floatFill = box(uv, vec2(0.03, 0.54), vec2(0.18, 0.54 + 0.40 * uFloat));
    col = mix(col, vec3(0.10, 0.10, 0.12), floatPanel);
    col = mix(col, vec3(uFloat), floatFill);

    col = mix(col, vec3(uVec2, 0.15), box(uv, vec2(0.23, 0.54), vec2(0.38, 0.94)));
    col = mix(col, uVec3, box(uv, vec2(0.43, 0.54), vec2(0.58, 0.94)));
    col = mix(col, uVec4.rgb, box(uv, vec2(0.63, 0.54), vec2(0.78, 0.94)));
    float alphaBand = box(uv, vec2(0.63, 0.54), vec2(0.78, 0.54 + 0.40 * uVec4.a));
    col = mix(col, vec3(1.0), alphaBand * 0.35);

    vec3 boolColor = uBool ? vec3(0.05, 0.9, 0.15) : vec3(0.05, 0.2, 0.95);
    col = mix(col, boolColor, box(uv, vec2(0.83, 0.54), vec2(0.97, 0.94)));

    vec3 cameraPosColor = 0.5 + 0.45 * iCameraPos / (1.0 + abs(iCameraPos));
    vec3 cameraDirColor = 0.5 + 0.5 * iCameraDir;
    col = mix(col, cameraPosColor, box(uv, vec2(0.03, 0.455), vec2(0.48, 0.515)));
    col = mix(col, cameraDirColor, box(uv, vec2(0.52, 0.455), vec2(0.97, 0.515)));
    float cameraDirOk = abs(length(iCameraDir) - 1.0) < 0.01 ? 1.0 : 0.0;
    col = mix(col, statusColor(cameraDirOk), box(uv, vec2(0.93, 0.465), vec2(0.96, 0.505)));

    float dateOk = iDate.x >= 2024.0 && iDate.y >= 0.0 && iDate.y <= 11.0 &&
        iDate.z >= 1.0 && iDate.z <= 31.0 && iDate.w >= 0.0 && iDate.w < 86400.0
        ? 1.0 : 0.0;
    col = mix(col, statusColor(dateOk), box(uv, vec2(0.03, 0.10), vec2(0.18, 0.42)));
    float secondsBand = box(
        uv,
        vec2(0.03, 0.10),
        vec2(0.03 + 0.15 * fract(iDate.w / 60.0), 0.14)
    );
    col = mix(col, vec3(1.0), secondsBand);

    vec4 checks = vec4(
        resolutionMatches(iCh0.size, vec3(256.0, 256.0, 1.0)) * (iCh0.loaded != 0 ? 1.0 : 0.0),
        resolutionMatches(iCh1.size, vec3(512.0, 2.0, 1.0)) * (iCh1.loaded != 0 ? 1.0 : 0.0),
        resolutionMatches(iCh2.size, vec3(256.0, 3.0, 1.0)) * (iCh2.loaded != 0 ? 1.0 : 0.0),
        resolutionMatches(iChannelResolution[3], vec3(0.0, 0.0, 0.0))
    );
    col = mix(col, statusColor(checks.x), box(uv, vec2(0.23, 0.10), vec2(0.38, 0.42)));
    col = mix(col, statusColor(checks.y), box(uv, vec2(0.43, 0.10), vec2(0.58, 0.42)));
    col = mix(col, statusColor(checks.z), box(uv, vec2(0.63, 0.10), vec2(0.78, 0.42)));
    col = mix(col, statusColor(checks.w), box(uv, vec2(0.83, 0.10), vec2(0.97, 0.42)));

    vec3 textureProbe = texture(iCh0.sampler, vec2(0.25, 0.75)).rgb;
    col = mix(col, textureProbe, box(uv, vec2(0.25, 0.34), vec2(0.36, 0.40)));
    float audioTimeBand = box(
        uv,
        vec2(0.43, 0.10),
        vec2(0.43 + 0.15 * fract(iCh1.time / 10.0), 0.14)
    );
    col = mix(col, vec3(1.0), audioTimeBand);

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
