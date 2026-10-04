// BufferA adds up 1536 faint lines into a float buffer (values far above 1.0); Image tone-maps them.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 energy = texture(iChannel0, fragCoord / iResolution.xy).rgb;
    fragColor = vec4(1.0 - exp(-energy), 1.0);
}
