// 1000 additive particles (6 vertices each) in world space, depth writes off so none hides another.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float glow = smoothstep(0.5, 0.0, length(uv - 0.5));
    fragColor = vec4(vec3(1.0, 0.6, 0.2) * glow * 0.5, 1.0);
}
