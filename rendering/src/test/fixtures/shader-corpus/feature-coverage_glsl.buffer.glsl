void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 textureColor = texture(patternTex, uv).rgb;
    float pulse = 0.5 + 0.5 * sin(iTime + uFloat);
    fragColor = vec4(mix(textureColor, coveragePalette(uv.x * 3.0), pulse * 0.35), 1.0);
}
