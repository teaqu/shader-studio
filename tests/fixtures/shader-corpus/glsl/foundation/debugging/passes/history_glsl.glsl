// GLSL twin of history.slang. The imported feedback helper is inlined.

vec3 debugFeedbackDecay(vec3 sampledHistory, float phase)
{
    vec3 accumulated = vec3(0.0);

    for (int index = 0; index < 4; ++index)
    {
        float harmonic = float(index + 1);
        float modulation = 0.97 + 0.005 * sin(phase * harmonic);
        accumulated += sampledHistory * modulation;
    }

    vec3 decayed = accumulated * 0.25;
    return decayed;
}

float debugBlob(vec2 position, vec2 center, float radius)
{
    vec2 delta = position - center;
    float distanceSquared = dot(delta, delta);
    float blob = exp(-distanceSquared / (radius * radius));
    return blob;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 resolution = iResolution.xy;
    vec2 uv = fragCoord / resolution;
    vec2 texelSize = 1.0 / resolution;

    vec3 sampledHistory = texture(iChannel0, uv + vec2(0.0, 0.7) * texelSize).rgb;
    vec3 previous = debugFeedbackDecay(sampledHistory, iTime);
    vec2 emitter = resolution * (0.5 + 0.3 * vec2(cos(iTime * 0.73), sin(iTime * 1.11)));
    float newInk = debugBlob(fragCoord, emitter, 13.0);
    vec3 inkColor = vec3(1.0, 0.28, 0.08) * newInk;

    if (iMouse.z > 0.0)
    {
        float mouseInk = debugBlob(fragCoord, iMouse.xy, 17.0);
        inkColor += vec3(0.12, 0.7, 1.0) * mouseInk;
    }

    vec3 history = previous * 0.975 + inkColor;
    float vignette = debugVignette(uv);
    fragColor = vec4(history * vignette, 1.0);
}
