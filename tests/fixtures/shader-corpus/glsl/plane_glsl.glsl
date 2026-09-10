void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 normal = normalize(iNormal);
    float diffuse = max(dot(normal, lightDir), 0.0);
    vec2 grid = abs(fract(uv * 10.0) - 0.5) * 2.0;
    float line = 1.0 - min(grid.x, grid.y);
    line = 1.0 - smoothstep(0.0, 0.1, line);
    vec3 col = mix(vec3(0.1, 0.15, 0.3), vec3(0.4, 0.6, 1.0), diffuse);
    col = mix(col, vec3(1.0), line * 0.3);
    fragColor = vec4(col, 1.0);
}
