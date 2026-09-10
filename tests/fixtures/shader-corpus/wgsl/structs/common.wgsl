// common.wgsl — shared type definitions for stride validation testing.
// WGSL mirror of ../slang/structs/common.slang. The engine infers each
// buffer stride from these layouts, including vec3f padding and matrices.

// 32 bytes: vec4f (16) + vec4f (16)
struct Particle {
    position: vec4f,
    velocity: vec4f,
};

// 48 bytes: vec4f (16) + vec4f (16) + vec4f (16)
struct ColoredParticle {
    position: vec4f,
    velocity: vec4f,
    color: vec4f,
};

// 48 bytes: vec3f (12, padded to 16) + f32 lifetime (offset 16) +
// vec4f extra (offset 32)
struct MixedLayout {
    direction: vec3f,   // offset 0, size 12, padded to 16
    lifetime: f32,      // offset 16, size 4
    extra: vec4f,       // offset 32, size 16
};

// 64 bytes: mat4x4f matrix
struct Transform {
    modelMatrix: mat4x4f,  // 64 bytes
};

// 80 bytes: mat4x4f (64) + vec4f (16)
struct RigidBody {
    transform: mat4x4f,
    angularVelocity: vec4f,
};
