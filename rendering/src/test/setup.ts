// Test setup: polyfill WebGPU flag-enum globals that browsers provide natively
// but that jsdom/Node do not. @webgpu/types only supplies compile-time types,
// not runtime values, so code under test that references GPUBufferUsage.* /
// GPUTextureUsage.* needs these defined when exercised outside a real browser.
// Values match the WebGPU spec (https://www.w3.org/TR/webgpu/#buffer-usage,
// https://www.w3.org/TR/webgpu/#texture-usage).

if (typeof globalThis.GPUBufferUsage === 'undefined') {
  (globalThis as unknown as { GPUBufferUsage: typeof GPUBufferUsage }).GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200
  };
}

if (typeof globalThis.GPUShaderStage === 'undefined') {
  (globalThis as unknown as { GPUShaderStage: typeof GPUShaderStage }).GPUShaderStage = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
  };
}

if (typeof globalThis.GPUTextureUsage === 'undefined') {
  (globalThis as unknown as { GPUTextureUsage: typeof GPUTextureUsage }).GPUTextureUsage = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10
  };
}
