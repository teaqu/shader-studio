float box(vec2 uv, vec2 lo, vec2 hi)
{
    vec2 insideLo = step(lo, uv);
    vec2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 video = texture(iChannel0, uv).rgb;
    float pulse = 0.5 + 0.5 * sin(iTime * 4.0 + uv.x * 18.0);
    vec3 underlay = mix(vec3(0.04, 0.04, 0.07), vec3(0.16, 0.08, 0.20), pulse);
    vec3 col = mix(underlay, video, 0.94);
    vec3 topSample = texture(iChannel0, vec2(0.5, 0.92)).rgb;
    vec3 leftSample = texture(iChannel0, vec2(0.08, 0.5)).rgb;
    vec3 bottomSample = texture(iChannel0, vec2(0.5, 0.08)).rgb;
    vec3 rightSample = texture(iChannel0, vec2(0.92, 0.5)).rgb;
    if (box(uv, vec2(0.06, 0.78), vec2(0.19, 0.91)) > 0.0) col = topSample;
    if (box(uv, vec2(0.06, 0.60), vec2(0.19, 0.73)) > 0.0) col = leftSample;
    if (box(uv, vec2(0.06, 0.42), vec2(0.19, 0.55)) > 0.0) col = bottomSample;
    if (box(uv, vec2(0.06, 0.24), vec2(0.19, 0.37)) > 0.0) col = rightSample;
    float marker = 1.0 - smoothstep(0.0, 0.012, abs(uv.x - fract(iTime * 0.18)));
    col = mix(col, vec3(1.0), marker * 0.75);
    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
