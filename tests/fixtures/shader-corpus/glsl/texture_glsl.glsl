void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 tex = texture(iChannel0, uv).rgb;
    vec2 cells = floor(uv * 16.0);
    float checker = mod(cells.x + cells.y, 2.0);
    vec3 underlay = mix(vec3(0.10, 0.10, 0.12), vec3(0.18, 0.18, 0.20), checker);
    vec3 col = mix(underlay, tex, 0.92);
    vec3 topSample = texture(iChannel0, vec2(0.5, 0.94)).rgb;
    vec3 leftSample = texture(iChannel0, vec2(0.06, 0.5)).rgb;
    vec3 bottomSample = texture(iChannel0, vec2(0.5, 0.06)).rgb;
    vec3 rightSample = texture(iChannel0, vec2(0.94, 0.5)).rgb;
    vec3 centerSample = texture(iChannel0, vec2(0.5, 0.5)).rgb;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.84 && uv.y < 0.96) col = topSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.68 && uv.y < 0.80) col = leftSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.52 && uv.y < 0.64) col = bottomSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.36 && uv.y < 0.48) col = rightSample;
    if (uv.x > 0.08 && uv.x < 0.20 && uv.y > 0.20 && uv.y < 0.32) col = centerSample;
    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
