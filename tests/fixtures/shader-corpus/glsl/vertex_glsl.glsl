// Custom GLSL vertex shader smoke test.
//
// The fragment shader fills whatever geometry the configured vertex shader
// produces. With vertex_glsl_vertex.glsl active, expect a rotated inset panel
// with black visible around it instead of the normal fullscreen image.

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;

    vec3 color = vec3(uv, 0.35 + 0.25 * sin(iTime));
    float gridX = step(0.92, fract(uv.x * 10.0));
    float gridY = step(0.92, fract(uv.y * 10.0));
    color = mix(color, vec3(1.0), max(gridX, gridY));

    fragColor = vec4(color, 1.0);
}
