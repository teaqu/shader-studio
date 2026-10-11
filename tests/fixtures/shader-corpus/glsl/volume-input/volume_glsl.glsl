// RGB encodes X, Y and Z. Move through depth with time.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    fragColor = texture(iChannel0, vec3(uv, 0.5 + 0.4 * sin(iTime)));
}
