// @vitest-environment node

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SlangCompiler, type SlangCompileResult } from "../../webgpu/SlangCompiler";
import type { SlangModuleApi } from "../../webgpu/slangTypes";
import type { StorageBindingNode } from "../../types/PassGraph";

type CreateSlangModule = () => Promise<SlangModuleApi>;

const bundledSlangModuleUrl = new URL("../../../../ui/src/slang/slang-wasm.js", import.meta.url);
const bundledSlangWasmUrl = new URL("../../../../ui/src/slang/slang-wasm.wasm", import.meta.url);
const hasBundledSlangWasm = existsSync(fileURLToPath(bundledSlangWasmUrl));

const atomicCounters: StorageBindingNode = {
  name: "counters",
  binding: 0,
  elementType: "Atomic<uint>",
  builtin: true,
  count: 4,
  stride: 4,
};

const coverageItems: StorageBindingNode = {
  name: "coverageItems",
  binding: 0,
  elementType: "float",
  builtin: true,
  count: 128,
  stride: 4,
};

function compiledWgsl(result: SlangCompileResult): string {
  if (!result.success) {
    throw new Error(result.errors.join("\n"));
  }
  return result.wgsl;
}

// The 21 MiB binary is deliberately gitignored. CI installs the pinned binary;
// local source-only checkouts skip this integration suite until the UI asset is installed.
describe.runIf(hasBundledSlangWasm)("SlangCompiler atomic storage with bundled slang-wasm", () => {
  let slang: SlangModuleApi;

  beforeAll(async () => {
    const module = await import(/* @vite-ignore */ bundledSlangModuleUrl.href) as {
      default: CreateSlangModule;
    };
    slang = await module.default();
  }, 30_000);

  it("compiles compute atomic writes and fragment scalar reads of the same storage", () => {
    const compiler = new SlangCompiler(slang);
    const computeWgsl = compiledWgsl(compiler.compileImagePass(
      `[shader("compute")]
      [numthreads(1, 1, 1)]
      void incrementCounter(uint3 id : SV_DispatchThreadID) { uint previous = counters[0].add(1u); }`,
      {
        passName: "ComputeAtomic",
        passKind: "compute",
        storage: [atomicCounters],
        hasOutput: false,
      },
    ));
    const fragmentWgsl = compiledWgsl(compiler.compileImagePass(
      "float4 mainImage(float2 coord) { return float4(float(counters[0]), 0, 0, 1); }",
      {
        passName: "Image",
        passKind: "render",
        storage: [atomicCounters],
      },
    ));

    expect(computeWgsl).toMatch(/var<storage, read_write> counters_\d+ : array<atomic<u32>>/);
    expect(computeWgsl).toContain("atomicAdd");
    expect(fragmentWgsl).toMatch(/var<storage, read> counters_\d+ : array<u32>/);
    expect(fragmentWgsl).not.toContain("atomic<u32>");
  });

  it("compiles a fullscreen vertex hook that reads render storage", () => {
    const compiler = new SlangCompiler(slang);
    const result = compiler.compileImagePass(
      "float4 mainImage(float2 coord) { return float4(coord, 0.0, 1.0); }",
      {
        passName: "Image",
        passKind: "render",
        storage: [coverageItems],
        vertexCode: "void mainVertex(inout float3 position, inout float3 normal, inout float2 uv) { position.xy += coverageItems[0].xx; }",
      },
    );

    expect(result.success ? result.wgsl : result.errors.join("\n")).toContain("fn vertexMain");
  });

  it("emits the selected native compute entry point for a multi-entry source", () => {
    const compiler = new SlangCompiler(slang);
    const wgsl = compiledWgsl(compiler.compileImagePass(`
      [shader("compute")] [numthreads(8, 8, 1)]
      void clearSamples(uint3 id : SV_DispatchThreadID) {}
      [shader("compute")] [numthreads(8, 8, 1)]
      void animateSamples(uint3 id : SV_DispatchThreadID) {}
    `, {
      passName: "ComputeAnimate",
      passKind: "compute",
      entryPoint: "animateSamples",
      hasOutput: false,
    }));

    expect(wgsl).toMatch(/@compute[\s\S]*fn animateSamples\s*\(/);
    expect(wgsl).not.toMatch(/@compute[\s\S]*fn clearSamples\s*\(/);
  });

  it("compiles native entry points for texel, count, workgroup, and storage-cover dispatch", () => {
    const compiler = new SlangCompiler(slang);
    const source = `
      [shader("compute")] [numthreads(8, 8, 1)]
      void texelMode(uint3 tid : SV_DispatchThreadID) { writeOutput(tid.xy, float4(1.0)); }
      [shader("compute")] [numthreads(64, 1, 1)]
      void countMode(uint3 tid : SV_DispatchThreadID) { writeOutput(uint2(tid.x, 0), float4(1.0)); }
      [shader("compute")] [numthreads(16, 8, 1)]
      void workgroupsMode(uint3 tid : SV_DispatchThreadID) { writeOutput(tid.xy, float4(1.0)); }
      [shader("compute")] [numthreads(16, 1, 1)]
      void coverStorageMode(uint3 tid : SV_DispatchThreadID) {
        coverageItems[tid.x] = float(tid.x);
        writeOutput(uint2(tid.x, 0), float4(coverageItems[tid.x]));
      }
    `;

    for (const entryPoint of ["texelMode", "countMode", "workgroupsMode", "coverStorageMode"]) {
      const result = compiler.compileImagePass(source, {
        passName: entryPoint,
        passKind: "compute",
        entryPoint,
        storage: [coverageItems],
        hasOutput: true,
        outputLayers: 1,
      });
      expect(result.success ? result.wgsl : result.errors.join("\n")).toContain(`fn ${entryPoint}`);
    }
  });

  it("compiles the dispatch-mode gallery image pass", () => {
    const compiler = new SlangCompiler(slang);
    const result = compiler.compileImagePass(`
      float4 mainImage(float2 fragCoord)
      {
        float2 uv = fragCoord / iResolution.xy;
        float2 localUv = frac(uv * 2.0);
        float4 texel = sampleIChannel0(localUv);
        float4 count = sampleIChannel1(localUv);
        float4 workgroups = sampleIChannel2(localUv);
        float4 storageCover = sampleIChannel3(localUv);
        if (uv.x < 0.5 && uv.y >= 0.5) return texel;
        if (uv.x >= 0.5 && uv.y >= 0.5) return count;
        if (uv.x < 0.5) return workgroups;
        return storageCover;
      }
    `, {
      passName: "Image",
      passKind: "render",
      channels: [0, 1, 2, 3].map((slot) => ({ slot, key: `iChannel${slot}`, kind: "buffer" as const })),
    });

    const wgsl = result.success ? result.wgsl : result.errors.join("\n");
    expect(wgsl).toContain("fn vertexMain");
    const mainImage = wgsl.slice(wgsl.indexOf("fn mainImage_0"), wgsl.indexOf("struct pixelOutput_0"));
    expect(mainImage.indexOf("sampleIChannel3_0")).toBeLessThan(mainImage.indexOf("if("));
  });

});
