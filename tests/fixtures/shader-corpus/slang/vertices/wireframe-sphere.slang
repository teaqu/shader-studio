// A sphere drawn with "topology": "line-list": each unique edge once, as a wireframe. Drag to orbit.
float4 mainImage(float2 fragCoord) {
    return float4(normalize(iNormal) * 0.5 + 0.5, 1.0);
}
