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
      "void computeMain(uint3 id) { uint previous = counters[0].add(1u); }",
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
});
