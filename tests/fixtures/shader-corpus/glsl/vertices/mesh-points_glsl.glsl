// A sphere drawn with "topology": "point-list": one point per mesh vertex. Drag to orbit.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = vec4(normalize(iNormal) * 0.5 + 0.5, 1.0);
}
