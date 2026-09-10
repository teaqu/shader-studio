import { describe, expect, it } from "vitest";
import { WGSL_INTRINSICS, findWgslIntrinsics } from "../intrinsics";

describe("WGSL_INTRINSICS", () => {
  it("covers the core numeric builtins", () => {
    for (const name of [
      "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "ceil", "clamp",
      "cos", "cosh", "countLeadingZeros", "countOneBits", "countTrailingZeros",
      "cross", "degrees", "determinant", "distance", "dot", "exp", "exp2",
      "extractBits", "faceForward", "firstLeadingBit", "firstTrailingBit",
      "floor", "fma", "fract", "frexp", "insertBits", "inverseSqrt", "ldexp",
      "length", "log", "log2", "max", "min", "mix", "modf", "normalize",
      "pow", "quantizeToF16", "radians", "reflect", "refract", "reverseBits",
      "round", "saturate", "select", "sign", "sin", "sinh", "smoothstep",
      "sqrt", "step", "tan", "tanh", "transpose", "trunc",
    ]) {
      expect(findWgslIntrinsics(name).length, name).toBeGreaterThan(0);
    }
  });

  it("covers texture, sampler, atomic, packing, derivative, and synchronization builtins", () => {
    for (const name of [
      "textureSample", "textureSampleBias", "textureSampleLevel", "textureSampleGrad",
      "textureSampleCompare", "textureSampleCompareLevel", "textureGather",
      "textureGatherCompare", "textureLoad", "textureStore", "textureDimensions",
      "textureNumLayers", "textureNumLevels", "textureNumSamples",
      "arrayLength", "atomicLoad", "atomicStore", "atomicAdd", "atomicSub",
      "atomicMax", "atomicMin", "atomicAnd", "atomicOr", "atomicXor",
      "atomicExchange", "atomicCompareExchangeWeak",
      "pack4x8snorm", "pack4x8unorm", "pack2x16snorm", "pack2x16unorm",
      "pack2x16float", "unpack4x8snorm", "unpack4x8unorm", "unpack2x16snorm",
      "unpack2x16unorm", "unpack2x16float",
      "dpdx", "dpdxCoarse", "dpdxFine", "dpdy", "dpdyCoarse", "dpdyFine",
      "fwidth", "fwidthCoarse", "fwidthFine",
      "workgroupUniformLoad", "storageBarrier", "workgroupBarrier", "textureBarrier",
    ]) {
      expect(findWgslIntrinsics(name).length, name).toBeGreaterThan(0);
    }
  });

  it("covers subgroup and quad builtins as compute-only", () => {
    for (const name of [
      "subgroupAdd", "subgroupExclusiveAdd", "subgroupInclusiveAdd",
      "subgroupMul", "subgroupExclusiveMul", "subgroupInclusiveMul",
      "subgroupMin", "subgroupMax", "subgroupAnd", "subgroupOr", "subgroupXor",
      "subgroupAll", "subgroupAny", "subgroupBallot",
      "subgroupBroadcast", "subgroupBroadcastFirst", "subgroupElect",
      "subgroupShuffle", "subgroupShuffleDown", "subgroupShuffleUp", "subgroupShuffleXor",
      "quadBroadcast", "quadSwapX", "quadSwapY", "quadSwapDiagonal",
    ]) {
      const found = findWgslIntrinsics(name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const entry of found) {
        expect(entry.stages, name).toEqual(["compute"]);
      }
    }
    expect(findWgslIntrinsics("subgroupBallot")[0]?.signature).toContain("vec4u");
    expect(findWgslIntrinsics("subgroupElect")[0]?.signature).toContain("bool subgroupElect()");
    expect(findWgslIntrinsics("quadSwapX")[0]?.signature).toContain("quadSwapX");
  });

  it("covers shader-stage builtin values with their stages", () => {
    const computeOnly = [
      "global_invocation_id", "local_invocation_id", "local_invocation_index",
      "workgroup_id", "num_workgroups", "workgroup_size",
      "subgroup_invocation_id", "subgroup_size", "num_subgroups",
    ];
    for (const name of computeOnly) {
      const found = findWgslIntrinsics(name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const entry of found) {
        expect(entry.stages, name).toEqual(["compute"]);
      }
    }
    const fragmentOnly = ["position", "front_facing", "frag_depth", "sample_index", "sample_mask"];
    for (const name of fragmentOnly) {
      const found = findWgslIntrinsics(name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const entry of found) {
        expect(entry.stages, name).toEqual(["fragment"]);
      }
    }
    const vertexOnly = ["vertex_index", "instance_index"];
    for (const name of vertexOnly) {
      const found = findWgslIntrinsics(name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const entry of found) {
        expect(entry.stages, name).toEqual(["vertex"]);
      }
    }
    expect(findWgslIntrinsics("global_invocation_id")[0]?.signature).toContain("vec3u");
    expect(findWgslIntrinsics("position")[0]?.signature).toContain("vec4f");
  });

  it("covers the logical and bit-reinterpretation builtins", () => {
    for (const name of ["all", "any", "bitcast"]) {
      const found = findWgslIntrinsics(name);
      expect(found.length, name).toBeGreaterThan(0);
      for (const entry of found) {
        expect(entry.kind, name).toBe("function");
        expect(entry.description.length, name).toBeGreaterThan(0);
      }
    }
  });

  it("keeps overloads such as atan findable", () => {
    expect(findWgslIntrinsics("atan").length).toBeGreaterThanOrEqual(2);
    expect(findWgslIntrinsics("textureSample").length).toBeGreaterThanOrEqual(2);
  });

  it("gives every entry a signature, description, and stage", () => {
    expect(WGSL_INTRINSICS.length).toBeGreaterThan(120);
    for (const intrinsic of WGSL_INTRINSICS) {
      expect(intrinsic.name.length).toBeGreaterThan(0);
      expect(intrinsic.signature).toContain(intrinsic.name);
      expect(intrinsic.description.length).toBeGreaterThan(0);
      expect(intrinsic.stages.length).toBeGreaterThan(0);
      expect(Object.isFrozen(intrinsic)).toBe(true);
    }
    expect(Object.isFrozen(WGSL_INTRINSICS)).toBe(true);
  });

  it("returns nothing unknown without throwing", () => {
    expect(findWgslIntrinsics("notABUILTIN")).toEqual([]);
    expect(findWgslIntrinsics("texture2D")).toEqual([]);
  });
});
