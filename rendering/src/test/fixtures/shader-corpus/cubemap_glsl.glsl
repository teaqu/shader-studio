// GLSL/WebGL cubemap comparison for cubemap.slang.
//
// Config: cubemap_glsl.sha.json binds assets/cubemap-cross.svg to iChannel0.
// Expected face colors: +X red, -X green, +Y blue, -Y yellow,
// +Z magenta, -Z cyan. The left swatches sample those six directions.

float box(vec2 uv, vec2 lo, vec2 hi)
{
    vec2 insideLo = step(lo, uv);
    vec2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

vec3 fallbackGrid(vec2 uv)
{
    vec2 cells = abs(fract(uv * 16.0) - 0.5);
    float line = 1.0 - smoothstep(0.46, 0.50, min(cells.x, cells.y));
    return mix(vec3(0.035, 0.038, 0.048), vec3(0.14, 0.14, 0.16), line * 0.35);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;

    float yaw = p.x * 1.55;
    float pitch = p.y * 0.95;
    vec3 dir = normalize(vec3(sin(yaw), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 cube = texture(iChannel0, dir).rgb;
    vec3 col = mix(fallbackGrid(uv), cube, 0.96);

    vec3 posX = texture(iChannel0, vec3(1.0, 0.0, 0.0)).rgb;
    vec3 negX = texture(iChannel0, vec3(-1.0, 0.0, 0.0)).rgb;
    vec3 posY = texture(iChannel0, vec3(0.0, 1.0, 0.0)).rgb;
    vec3 negY = texture(iChannel0, vec3(0.0, -1.0, 0.0)).rgb;
    vec3 posZ = texture(iChannel0, vec3(0.0, 0.0, 1.0)).rgb;
    vec3 negZ = texture(iChannel0, vec3(0.0, 0.0, -1.0)).rgb;

    if (box(uv, vec2(0.06, 0.80), vec2(0.18, 0.92)) > 0.0) col = posX;
    if (box(uv, vec2(0.06, 0.66), vec2(0.18, 0.78)) > 0.0) col = negX;
    if (box(uv, vec2(0.06, 0.52), vec2(0.18, 0.64)) > 0.0) col = posY;
    if (box(uv, vec2(0.06, 0.38), vec2(0.18, 0.50)) > 0.0) col = negY;
    if (box(uv, vec2(0.06, 0.24), vec2(0.18, 0.36)) > 0.0) col = posZ;
    if (box(uv, vec2(0.06, 0.10), vec2(0.18, 0.22)) > 0.0) col = negZ;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
