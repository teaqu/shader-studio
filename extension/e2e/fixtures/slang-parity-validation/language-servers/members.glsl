struct Material {
    vec3 albedo;
    float rough;
};

float blend(vec2 uv, vec2 lo, vec2 hi) {
    return uv.x + lo.x + hi.x;
}

void mainImage(out vec4 rendered, in vec2 pixelPosition) {
    Material material = Material(vec3(0.25, 0.5, 0.75), 0.5);
    vec2 uv = pixelPosition / iResolution.xy;
    float weight = blend(uv, max(uv, vec2(0.0, 1.0)), vec2(1.0));
    rendered = vec4(material.albedo.zyx * weight, material.rough);
}
