void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;

    vec3 videoColor = texture(iChannel0, uv).rgb;
    float spectrum = texture(iChannel1, vec2(uv.x, 0.25)).r;
    float waveform = texture(iChannel1, vec2(uv.x, 0.75)).r;

    float bar = smoothstep(uv.y - 0.015, uv.y + 0.015, spectrum * 0.85);
    float waveLine = 1.0 - smoothstep(0.0, 0.015, abs(uv.y - (0.5 + (waveform - 0.5) * 0.45)));

    vec3 color = videoColor * 0.45;
    color += vec3(0.05, 0.85, 1.0) * bar;
    color += vec3(1.0, 0.95, 0.2) * waveLine;

    if (uv.x < 0.03) {
        color = vec3(spectrum, waveform, 0.2);
    }

    fragColor = vec4(color, 1.0);
}
