#language slang 2026
module debug_coverage_history;
import debugfeedback;

float debugBlob(float2 position, float2 center, float radius)
{
    float2 delta = position - center;
    float distanceSquared = dot(delta, delta);
    float blob = exp(-distanceSquared / (radius * radius));
    return blob;
}

float4 mainImage(float2 fragCoord)
{
    float2 resolution = iResolution.xy;
    float2 uv = fragCoord / resolution;
    float2 texelSize = 1.0 / resolution;

    float3 sampledHistory = inputs.iChannel0.Sample(uv + float2(0.0, 0.7) * texelSize).rgb;
    float3 previous = debugFeedbackDecay(sampledHistory, iTime);
    float2 emitter = resolution * (0.5 + 0.3 * float2(cos(iTime * 0.73), sin(iTime * 1.11)));
    float newInk = debugBlob(fragCoord, emitter, 13.0);
    float3 inkColor = float3(1.0, 0.28, 0.08) * newInk;

    if (iMouse.z > 0.0)
    {
        float mouseInk = debugBlob(fragCoord, iMouse.xy, 17.0);
        inkColor += float3(0.12, 0.7, 1.0) * mouseInk;
    }

    float3 history = previous * 0.975 + inkColor;
    float vignette = debugVignette(uv);
    return float4(history * vignette, 1.0);
}
