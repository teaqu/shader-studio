// World-space tetrahedron: 12 vertices, lit by iNormal, back faces culled. Drag to orbit.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    float light = max(dot(iNormal, normalize(vec3(0.5, 1.0, 0.3))), 0.0);
    fragColor = vec4(vec3(0.15, 0.2, 0.35) + vec3(0.9, 0.7, 0.4) * light, 1.0);
}
