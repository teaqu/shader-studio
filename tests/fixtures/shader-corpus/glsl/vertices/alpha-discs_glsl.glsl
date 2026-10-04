// Three see-through discs with alpha blending. uv.x carries disc id + local x, so mainImage can colour each.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float t = fragCoord.x / iResolution.x * 3.0;
    float id = floor(t);
    vec2 local = vec2(fract(t), fragCoord.y / iResolution.y) - 0.5;
    float disc = smoothstep(0.5, 0.47, length(local));
    vec3 colour = id < 1.0 ? vec3(1.0, 0.2, 0.2) : id < 2.0 ? vec3(0.2, 1.0, 0.2) : vec3(0.2, 0.4, 1.0);
    fragColor = vec4(colour, 0.6 * disc);
}
