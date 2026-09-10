void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    float scanline = 3.75 + 0.25 * sin(uv.y * 220.0 + iTime * 8.0);
    fragColor = vec4(vec3(1.0, 0.48, 0.08) * scanline, 1.0);
}
