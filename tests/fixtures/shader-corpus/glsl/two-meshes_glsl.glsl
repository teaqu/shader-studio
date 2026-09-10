void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    float light = 0.3 + 0.7 * max(dot(normalize(iNormal), normalize(vec3(0.4, 0.8, 0.3))), 0.0);
    vec3 body = mix(vec3(0.03, 0.1, 0.28), vec3(0.06, 0.7, 1.0), uv.y) * light;
    fragColor = vec4(body + texture(iChannel0, uv).rgb * 0.35, 1.0);
}
