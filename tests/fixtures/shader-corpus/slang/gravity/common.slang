// common.slang — shared types and helpers

struct Body
{
    float4 position;   // xyz = position, w = mass
    float4 velocity;   // xyz = velocity, w = padding
};

float3 gravityForce(Body a, Body b)
{
    float3 dir = b.position.xyz - a.position.xyz;
    float dist = length(dir);
    if (dist < 0.001) { return float3(0, 0, 0); }
    float strength = b.position.w / (dist * dist);
    return normalize(dir) * strength;
}
