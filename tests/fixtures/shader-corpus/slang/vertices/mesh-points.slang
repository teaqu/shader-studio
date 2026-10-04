// A sphere drawn with "topology": "point-list": one point per mesh vertex. Drag to orbit.
float4 mainImage(float2 fragCoord) {
    return float4(normalize(iNormal) * 0.5 + 0.5, 1.0);
}
