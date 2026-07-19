import { describe, expect, it } from "vitest";
import type { StorageBindingNode } from "../../types/PassGraph";
import { buildStorageDeclarations, wrapSlangImageSource } from "../../webgpu/SlangPrelude";

const lanes: StorageBindingNode = {
  name: "lanes",
  binding: 0,
  elementType: "float4",
  builtin: true,
  count: 1024,
  stride: 16,
};

const boids: StorageBindingNode = {
  name: "boids",
  binding: 1,
  elementType: "Boid",
  builtin: false,
  count: 1024,
  stride: 32,
};

const atomicCounters: StorageBindingNode = {
  name: "counters",
  binding: 2,
  elementType: "Atomic<uint>",
  builtin: true,
  count: 4,
  stride: 4,
};

describe("SlangPrelude storage declarations", () => {
  it("splits compute storage declarations around common code with channel-offset RW bindings", () => {
    const declarations = buildStorageDeclarations([lanes, boids], 2, "compute");

    expect(declarations.beforeCommon).toBe(
      "[[vk::binding(5, 0)]]\nRWStructuredBuffer<float4> lanes;\n",
    );
    expect(declarations.afterCommon).toBe(
      "[[vk::binding(6, 0)]]\nRWStructuredBuffer<Boid> boids;\n",
    );
  });

  it("uses read-only structured buffers for render passes", () => {
    const declarations = buildStorageDeclarations([lanes], 0, "render");

    expect(declarations.beforeCommon).toContain("StructuredBuffer<float4> lanes;");
    expect(declarations.beforeCommon).not.toContain("RWStructuredBuffer");
  });

  it("exposes direct atomic elements as scalar reads only in render passes", () => {
    const renderDeclarations = buildStorageDeclarations([
      atomicCounters,
      { ...atomicCounters, name: "signedCounters", binding: 3, elementType: "Atomic<int>" },
    ], 0, "render");
    const computeDeclarations = buildStorageDeclarations([atomicCounters], 0, "compute");

    expect(renderDeclarations.beforeCommon).toContain("StructuredBuffer<uint> counters;");
    expect(renderDeclarations.beforeCommon).toContain("StructuredBuffer<int> signedCounters;");
    expect(renderDeclarations.beforeCommon).not.toContain("StructuredBuffer<Atomic");
    expect(computeDeclarations.beforeCommon)
      .toContain("RWStructuredBuffer<Atomic<uint>> counters;");
  });

  it("does not rewrite custom storage types that may contain atomic fields", () => {
    const declarations = buildStorageDeclarations([boids], 0, "render");

    expect(declarations.afterCommon).toContain("StructuredBuffer<Boid> boids;");
  });

  it("defaults storage declarations to read-only structured buffers", () => {
    const wrapped = wrapSlangImageSource("float4 mainImage(float2 c) { return float4(0); }", {
      storage: [lanes],
    });

    expect(wrapped).toContain("StructuredBuffer<float4> lanes;");
    expect(wrapped).not.toContain("RWStructuredBuffer");
  });

  it("places built-in declarations before common code and custom declarations after it", () => {
    const wrapped = wrapSlangImageSource("float4 mainImage(float2 c) { return float4(0); }", {
      commonCode: "struct Boid { float4 position; };",
      storage: [lanes, boids],
      passKind: "compute",
    });

    expect(wrapped.indexOf("RWStructuredBuffer<float4> lanes;")).toBeLessThan(
      wrapped.indexOf("struct Boid"),
    );
    expect(wrapped.indexOf("struct Boid")).toBeLessThan(
      wrapped.indexOf("RWStructuredBuffer<Boid> boids;"),
    );
  });

  it("keeps #line 1 directly before the user source after custom storage declarations", () => {
    const source = "float4 mainImage(float2 c) { return float4(0); }";
    const wrapped = wrapSlangImageSource(source, {
      commonCode: "struct Boid { float4 position; };",
      storage: [lanes, boids],
      passKind: "compute",
    });

    expect(wrapped).toContain(`#line 1\n${source}`);
    expect(wrapped.indexOf("RWStructuredBuffer<Boid> boids;")).toBeLessThan(
      wrapped.indexOf("#line 1"),
    );
  });

  it("uses storage binding indices even when tier placement reverses declaration order", () => {
    const wrapped = wrapSlangImageSource("float4 mainImage(float2 c) { return float4(0); }", {
      commonCode: "struct Boid { float4 position; };",
      channels: [
        { slot: 0, key: "iChannel0" },
        { slot: 1, key: "iChannel1" },
      ],
      storage: [
        { ...boids, binding: 0 },
        { ...lanes, binding: 1 },
      ],
      passKind: "compute",
    });

    expect(wrapped).toContain("[[vk::binding(6, 0)]]\nRWStructuredBuffer<float4> lanes;");
    expect(wrapped).toContain("[[vk::binding(5, 0)]]\nRWStructuredBuffer<Boid> boids;");
    expect(wrapped.indexOf("RWStructuredBuffer<float4> lanes;")).toBeLessThan(
      wrapped.indexOf("RWStructuredBuffer<Boid> boids;"),
    );
  });

  it("shifts capture uniforms past channels and storage declarations", () => {
    const wrapped = wrapSlangImageSource("float4 mainImage(float2 c) { return float4(0); }", {
      channels: [
        { slot: 0, key: "iChannel0" },
        { slot: 1, key: "iChannel1" },
      ],
      storage: [lanes, boids],
      captureMode: true,
    });

    expect(wrapped).toContain("[[vk::binding(7, 0)]]\nConstantBuffer<DbgCaptureUniforms> _dbgCapU;");
    expect(wrapped).toContain("shader-studio Slang capture entry points");
  });

  it("places capture uniforms after both storage declaration tiers", () => {
    const source = "float4 mainImage(float2 c) { return float4(0); }";
    const wrapped = wrapSlangImageSource(source, {
      commonCode: "struct Boid { float4 position; };",
      storage: [lanes, boids],
      passKind: "compute",
      captureMode: true,
    });

    expect(wrapped.indexOf("RWStructuredBuffer<float4> lanes;")).toBeLessThan(
      wrapped.indexOf("struct Boid"),
    );
    expect(wrapped.indexOf("struct Boid")).toBeLessThan(
      wrapped.indexOf("RWStructuredBuffer<Boid> boids;"),
    );
    expect(wrapped.indexOf("RWStructuredBuffer<Boid> boids;")).toBeLessThan(
      wrapped.indexOf("ConstantBuffer<DbgCaptureUniforms> _dbgCapU;"),
    );
    expect(wrapped.indexOf("ConstantBuffer<DbgCaptureUniforms> _dbgCapU;")).toBeLessThan(
      wrapped.indexOf(`#line 1\n${source}`),
    );
  });

  it("preserves the existing wrapper output when storage and common code are absent", () => {
    const source = "float4 mainImage(float2 c) { return float4(0); }";
    const wrapped = wrapSlangImageSource(source);

    expect(wrapped).not.toContain("StructuredBuffer");
    expect(wrapped).toContain(`#line 1\n${source}`);
    expect(wrapped).toContain("shader-studio Slang entry points");
  });
});
