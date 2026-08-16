void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 col = vec3(0.0);

    col += texture(iChannel0, uv).rgb;
    col += texture(iChannel1, uv).rgb;
    col += texture(iChannel2, uv).rgb;
    col += texture(iChannel3, uv).rgb;
    col += texture(iChannel4, uv).rgb;
    col += texture(iChannel5, uv).rgb;
    col += texture(iChannel6, uv).rgb;
    col += texture(iChannel7, uv).rgb;
    col += texture(iChannel8, uv).rgb;
    col += texture(iChannel9, uv).rgb;
    col += texture(iChannel10, uv).rgb;
    col += texture(iChannel11, uv).rgb;
    col += texture(iChannel12, uv).rgb;
    col += texture(iChannel13, uv).rgb;
    col += texture(iChannel14, uv).rgb;
    col += texture(iChannel15, uv).rgb;
    col += texture(iChannel16, uv).rgb;
    col += texture(iChannel17, uv).rgb;
    col += texture(iChannel18, uv).rgb;
    col += texture(iChannel19, uv).rgb;
    col += texture(iChannel20, uv).rgb;
    col += texture(iChannel21, uv).rgb;
    col += texture(iChannel22, uv).rgb;
    col += texture(iChannel23, uv).rgb;
    col += texture(iChannel24, uv).rgb;
    col += texture(iChannel25, uv).rgb;
    col += texture(iChannel26, uv).rgb;
    col += texture(iChannel27, uv).rgb;
    col += texture(iChannel28, uv).rgb;
    col += texture(iChannel29, uv).rgb;
    col += texture(iChannel30, uv).rgb;

    col /= 32.0;
    fragColor = vec4(col, 1.0);
}
