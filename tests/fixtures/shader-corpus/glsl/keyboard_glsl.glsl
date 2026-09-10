float keyRow(float keyCode, float row)
{
    vec2 uv = vec2((keyCode + 0.5) / 256.0, (row + 0.5) / 3.0);
    return texture(iChannel0, uv).r;
}

float box(vec2 uv, vec2 lo, vec2 hi)
{
    vec2 insideLo = step(lo, uv);
    vec2 insideHi = step(uv, hi);
    return insideLo.x * insideLo.y * insideHi.x * insideHi.y;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    float aHeld = keyRow(65.0, 0.0);
    float sHeld = keyRow(83.0, 0.0);
    float dHeld = keyRow(68.0, 0.0);
    float spacePressed = keyRow(32.0, 1.0);
    float leftToggled = keyRow(37.0, 2.0);
    float rightToggled = keyRow(39.0, 2.0);
    vec3 col = vec3(0.03) + 0.06 * vec3(uv.x, uv.y, 1.0 - uv.x);
    col += box(uv, vec2(0.06, 0.25), vec2(0.31, 0.75)) * aHeld * vec3(1.0, 0.08, 0.05);
    col += box(uv, vec2(0.37, 0.25), vec2(0.62, 0.75)) * sHeld * vec3(0.05, 1.0, 0.12);
    col += box(uv, vec2(0.68, 0.25), vec2(0.93, 0.75)) * dHeld * vec3(0.08, 0.25, 1.0);
    col += box(uv, vec2(0.12, 0.84), vec2(0.88, 0.94)) * spacePressed;
    col += box(uv, vec2(0.02, 0.08), vec2(0.12, 0.92)) * leftToggled * vec3(1.0, 0.0, 1.0);
    col += box(uv, vec2(0.88, 0.08), vec2(0.98, 0.92)) * rightToggled * vec3(0.0, 1.0, 1.0);
    if (uv.y > 0.985) col = vec3(1.0, 0.0, 0.0);
    if (uv.x < 0.008) col = vec3(0.0, 1.0, 0.0);
    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
