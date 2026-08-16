#include "common.glsl"

float shade(float value) {
    return twice(value) * 0.5;
}

void mainImage(out vec4 rendered, in vec2 pixelPosition) {
    vec3 literalColor = vec3(1.0, 0.5, 0.0);
    vec2 uv = pixelPosition / iResolution.xy;
    rendered = texture(iChannel0, uv) + vec4(shade(literalColor.r));
}
