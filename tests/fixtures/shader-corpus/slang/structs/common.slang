// common.slang — shared type definitions for stride validation testing

// 32 bytes: float4 (16) + float4 (16)
struct Particle
{
    float4 position;
    float4 velocity;
};

// 48 bytes: float4 (16) + float4 (16) + float4 (16)
struct ColoredParticle
{
    float4 position;
    float4 velocity;
    float4 color;
};

// 32 bytes: float3 (12→16 aligned) + float (4→pad) + float4 (16)
// Note: float3 alignment = 16, so position takes 16 bytes
struct MixedLayout
{
    float3 direction;   // offset 0, size 12, padded to 16
    float lifetime;     // offset 16, size 4
    float4 extra;       // offset 32, size 16
};
// Expected total: 48 bytes (16 + 4 pad to 16 + 16 = align to 16 = 48)

// 64 bytes: float4x4 matrix
struct Transform
{
    float4x4 modelMatrix;  // 64 bytes
};

// 80 bytes: float4x4 (64) + float4 (16)
struct RigidBody
{
    float4x4 transform;
    float4 angularVelocity;
};
