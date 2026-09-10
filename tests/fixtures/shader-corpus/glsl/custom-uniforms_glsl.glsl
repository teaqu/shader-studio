void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    float r = uRed;
    float g = uGreen;
    float b = 0.5 + 0.5 * sin(iTime + uOffset);
    fragColor = vec4(r, g, b + uv.x * 0.0, 1.0);
}
