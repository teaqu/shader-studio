// Each instance gets its own hue from iInstanceIndex / iInstanceCount. Drag to orbit.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float t = float(iInstanceIndex) / float(iInstanceCount);
    vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (t + vec3(0.0, 0.33, 0.67)));
    float light = 0.35 + 0.65 * max(dot(normalize(iNormal), normalize(vec3(0.4, 1.0, 0.3))), 0.0);
    fragColor = vec4(hue * light, 1.0);
}
